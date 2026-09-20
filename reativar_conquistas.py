#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ReativaConquistas — Re-enable achievements on Minecraft Bedrock worlds.

Problema: em mundos do Minecraft Bedrock, ativar cheats/entrar em Creative marca
o level.dat com cheatsEnabled=1, commandsEnabled=1 e hasBeenLoadedInCreative=1,
o que desativa conquistas para sempre.

Solucao: zerar esses 3 flags (Byte) e, opcionalmente, definir o modo de jogo
padrao para Sobrevivencia (GameType=0), necessario para ganhar conquistas.

O patch e feito byte-a-byte apenas nos valores-alvo; todo o resto do level.dat
permanece identico. O arquivo .mcworld original nunca e alterado: um novo
"<nome>-conquistas.mcworld" e gerado.

Uso:
  python reativar_conquistas.py   mundo.mcworld [outro.mcworld ...]
  python reativar_conquistas.py   pasta_de_mundos/              # varre *.mcworld
  python reativar_conquistas.py   pasta_com_level.dat/          # patcha no lugar
  python reativar_conquistas.py   level.dat
  python reativar_conquistas.py --keep-game-mode mundo.mcworld  # nao muda p/ survival
  python reativar_conquistas.py --server 8080                   # servidor web (site)
  python reativar_conquistas.py --check  mundo.mcworld          # dry-run

No Windows voce tambem pode arrastar os arquivos .mcworld para cima de
"ReativarConquistas.bat".

Modo servidor: o cliente faz upload do .mcworld, recebe na hora o mesmo arquivo
corrigido (level.dat com conquistas reativadas) para baixar.
"""

import io
import os
import re
import sys
import json
import socket
import struct
import gzip
import zipfile
import argparse
import tempfile
import threading
import hashlib
import hmac
import secrets
import smtplib
import time
import urllib.request
import urllib.parse
import urllib.error

# ---------------------------------------------------------------- NBT (LE) --
TAG_END = 0; TAG_BYTE = 1; TAG_SHORT = 2; TAG_INT = 3; TAG_LONG = 4
TAG_FLOAT = 5; TAG_DOUBLE = 6; TAG_BYTE_ARRAY = 7; TAG_STRING = 8
TAG_LIST = 9; TAG_COMPOUND = 10; TAG_INT_ARRAY = 11; TAG_LONG_ARRAY = 12

GAME_MODE_SURVIVAL = 0
GAME_MODE_CREATIVE = 1

FLAGS_TO_CLEAR = ("commandsEnabled", "cheatsEnabled", "hasBeenLoadedInCreative")

# ------------------------------------------------- configuracao do site ---
# A chave do AbacatePay fica SOMENTE aqui no servidor (nunca no navegador).
# Producao: defina a variavel de ambiente ABACATEPAY_API_KEY com a chave
# de PRODUCAO (abc_...) gerada no dashboard AbacatePay. Sem ela, o Premium
# nao gera cobranca (o servidor responde 502 explicando).
ABACATEPAY_API_KEY = os.environ.get("ABACATEPAY_API_KEY", "")
ABACATEPAY_BASE_V1 = os.environ.get(
    "ABACATEPAY_BASE_V1", "https://api.abacatepay.com/v1")
ABACATEPAY_BASE_V2 = os.environ.get(
    "ABACATEPAY_BASE_V2", "https://api.abacatepay.com/v2")
# ID do produto "Premium 30 dias" criado no dashboard AbacatePay
# (Produtos -> Novo produto, preco R$ 6,99, pagamento unico).
# OBRIGATORIO para chaves abc_dev_... (API v2). Ex.: prod_abc123xyz
ABACATEPAY_PRODUCT_ID = os.environ.get("ABACATEPAY_PRODUCT_ID", "")
# Segredo opcional do webhook: se definido, o AbacatePay deve chamar
# /api/abacate/webhook?secret=VALOR. Chamadas sem o segredo sao ignoradas.
ABACATEPAY_WEBHOOK_SECRET = os.environ.get("ABACATEPAY_WEBHOOK_SECRET", "")
# Contas e sessoes
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
PBKDF2_ROUNDS = int(os.environ.get("PBKDF2_ROUNDS", "200000"))
# E-mail (codigo de verificacao). Sem isso, o codigo vai p/ o terminal (teste).
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "no-reply@localhost")
SMTP_CONFIGURED = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
PREMIUM_PRICE_CENTS = int(os.environ.get("PREMIUM_PRICE_CENTS", "699"))
PREMIUM_DAYS = int(os.environ.get("PREMIUM_DAYS", "30"))
PREMIUM_PRODUCT_NAME = os.environ.get(
    "PREMIUM_PRODUCT_NAME", "ReativaConquistas Premium — 30 dias")
FREE_PER_WEEK = int(os.environ.get("FREE_PER_WEEK", "1"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
MAX_JSON_BYTES = 64 * 1024
CSP_HTML = ("default-src 'self'; img-src 'self' data: blob: https:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; "
            "connect-src 'self' https://reativa-pay.rosidomingos032.workers.dev "
            "https://*.googleapis.com https://*.firebaseapp.com; "
            "frame-src https://*.firebaseapp.com https://accounts.google.com; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "")  # ex.: https://seudominio.com.br

SUPPORT_EMAIL = "suporte@seudominio.com.br"


class Reader:
    def __init__(self, data):
        self.data = data
        self.p = 0

    def read(self, n):
        v = self.data[self.p:self.p + n]
        if len(v) < n:
            raise ValueError("NBT truncado em offset %d" % self.p)
        self.p += n
        return v

    def byte(self):
        return self.read(1)[0]

    def uint16(self):
        return struct.unpack("<H", self.read(2))[0]

    def string(self):
        return self.read(self.uint16()).decode("utf-8", "replace")

    def int_(self):
        return struct.unpack("<i", self.read(4))[0]

    def long_(self):
        return struct.unpack("<q", self.read(8))[0]


def _skip_compound_body(r):
    """Pula um compound SEM cabecalho de nome (elemento de lista, ou o corpo
    de um compound ja nomeado)."""
    while True:
        t = r.byte()
        if t == TAG_END:
            return
        r.string()
        _skip_payload(r, t)


def _skip_payload(r, tag):
    """Lê o payload de `tag` sem coletar nomes (apenas para avanço seguro).
    `tag` refere-se a uma tag já nomeada (nome consumido pelo chamador)."""
    if tag == TAG_BYTE:
        r.read(1)
    elif tag == TAG_SHORT:
        r.read(2)
    elif tag == TAG_INT:
        r.read(4)
    elif tag == TAG_LONG:
        r.read(8)
    elif tag == TAG_FLOAT:
        r.read(4)
    elif tag == TAG_DOUBLE:
        r.read(8)
    elif tag == TAG_BYTE_ARRAY:
        r.read(r.int_())
    elif tag == TAG_INT_ARRAY:
        r.read(4 * r.int_())
    elif tag == TAG_LONG_ARRAY:
        r.read(8 * r.int_())
    elif tag == TAG_STRING:
        r.read(r.uint16())
    elif tag == TAG_LIST:
        elem = r.byte()
        n = r.int_()
        for _ in range(n):
            if elem == TAG_COMPOUND:
                _skip_compound_body(r)
            else:
                _skip_payload(r, elem)
    elif tag == TAG_COMPOUND:
        _skip_compound_body(r)
    else:
        raise ValueError("tag NBT desconhecida: %r" % (tag,))


def _walk_collect(r, hits):
    """Anda por todo o NBT e, para cada tag nomeada, guarda (path, offset_do_valor)."""
    def recurse(path):
        while True:
            t = r.byte()
            if t == TAG_END:
                return
            name = r.string()
            val_off = r.p
            if t == TAG_BYTE:
                v = r.byte()
                hits.setdefault(name, []).append((path, val_off, v, TAG_BYTE))
            elif t == TAG_INT:
                v = r.int_()
                hits.setdefault(name, []).append((path, val_off, v, TAG_INT))
            elif t == TAG_LONG:
                r.long_()
            elif t in (TAG_SHORT, TAG_FLOAT, TAG_DOUBLE,):
                _skip_payload(r, t)
            elif t in (TAG_BYTE_ARRAY, TAG_INT_ARRAY, TAG_LONG_ARRAY, TAG_STRING):
                _skip_payload(r, t)
            elif t == TAG_LIST:
                elem = r.byte()
                n = r.int_()
                for i in range(n):
                    if elem == TAG_COMPOUND:
                        recurse("%s/%s[%d]" % (path, name, i))
                    else:
                        _skip_payload(r, elem)
            elif t == TAG_COMPOUND:
                recurse("%s/%s" % (path, name))
            else:
                raise ValueError("tag NBT desconhecida: %r" % (t,))

    if r.byte() != TAG_COMPOUND:
        raise ValueError("raiz do NBT nao e TAG_Compound")
    r.string()  # nome da raiz (vazio no level.dat)
    recurse("/")


def extract_level_dat(data):
    """
    Descobre o formato e retorna o corpo NBT + metadados para reescrever.
    Suporta: cabecalho 8B (LE int32 versao + int32 tamanho), NBT puro, e gzip.
    """
    raw = data
    gzipped = False
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
        gzipped = True
    header = False
    if len(raw) >= 12 and raw[0] == 0x0a:
        ver = struct.unpack("<i", raw[0:4])[0]
        ln = struct.unpack("<i", raw[4:8])[0]
        if 0 < ln <= len(raw) - 8:
            header = True
            body = raw[8:8 + ln]
            return body, {"version": ver, "header": True, "gzipped": gzipped}
        # sem cabecalho confiavel -> tratar como NBT puro
    return raw, {"version": 10, "header": False, "gzipped": gzipped}


def pack_level_dat(body, meta):
    data = body
    if meta["header"]:
        data = struct.pack("<ii", meta["version"], len(body)) + body
    if meta["gzipped"]:
        data = gzip.compress(data, mtime=0)
    return data


def find_targets(body):
    r = Reader(body)
    hits = {}
    _walk_collect(r, hits)
    return hits


def patch_level_dat_bytes(data, game_mode="survival"):
    """
    data: bytes de um level.dat (qualquer formato suportado).
    Retorna (bytes_corrigidos, lista_de_mudancas).
    """
    body, meta = extract_level_dat(data)
    hits = find_targets(body)
    buf = bytearray(body)
    changes = []

    for name in FLAGS_TO_CLEAR:
        for path, off, old, tag in hits.get(name, ()):
            if tag != TAG_BYTE or old == 0:
                continue
            buf[off] = 0
            changes.append("byte %s (%s) = %d -> 0" % (path, name, old))

    if game_mode != "keep":
        for path, off, old, tag in hits.get("GameType", ()):
            if tag != TAG_INT:
                continue
            new = GAME_MODE_SURVIVAL if game_mode == "survival" else GAME_MODE_CREATIVE
            if old != new:
                struct.pack_into("<i", buf, off, new)
                changes.append("int  %s (%s) = %d -> %d" % (path, "GameType", old, new))

    return pack_level_dat(bytes(buf), meta), changes


def validate_level_dat(data):
    """Re-lê e garante integralidade: 0 bytes sobrando e flags zeradas."""
    body, meta = extract_level_dat(data)
    r = Reader(body)
    # andar o NBT inteiro
    t = r.byte()
    if t != TAG_COMPOUND:
        raise ValueError("root nao e TAG_Compound")
    r.string()
    _skip_payload(r, TAG_COMPOUND)
    if r.p != len(body):
        raise ValueError("bytes sobrando no NBT: %d" % (len(body) - r.p))
    hits = find_targets(body)
    for name in FLAGS_TO_CLEAR:
        for _path, _off, v, tag in hits.get(name, ()):
            if tag == TAG_BYTE and v != 0:
                raise ValueError("%s ainda = %d" % (name, v))
    return True


# ------------------------------------------------------- processamento ------
def patch_mcworld_data(zip_bytes, game_mode="survival", strip_behavior_packs=False,
                       icon_bytes=None, icon_ext=".png", world_name=None):
    """Entra: bytes de um .mcworld. Sai: (bytes do .mcworld corrigido, relatorio)."""
    zin = zipfile.ZipFile(io.BytesIO(zip_bytes))
    try:
        infos = zin.infolist()
        level_name = "level.dat"
        for i in infos:
            if i.filename.lower() == "level.dat":
                level_name = i.filename
                break
        else:
            raise ValueError("arquivo level.dat nao encontrado no .mcworld")
        original = zin.read(level_name)
        patched, changes = patch_level_dat_bytes(original, game_mode)
        validate_level_dat(patched)
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as zout:
            wrote_name = False
            for info in infos:
                if strip_behavior_packs and info.filename.lower() == "world_behavior_packs.json":
                    changes.append("removido world_behavior_packs.json (evita re-bloqueio)")
                    continue
                data = zin.read(info.filename)
                if info.filename == level_name:
                    data = patched
                if world_name and info.filename.lower() == "levelname.txt":
                    data = world_name.encode("utf-8")
                    wrote_name = True
                zout.writestr(info, data)
            if icon_bytes:
                # Troca a foto/icone do mundo (Premium). O Bedrock le pack_icon.png.
                zout.writestr("pack_icon.png", icon_bytes)
                changes.append("icone do mundo substituido (pack_icon.png)")
            if world_name and not wrote_name:
                zout.writestr("levelname.txt", world_name.encode("utf-8"))
            if world_name:
                changes.append("nome do mundo alterado p/ %r" % world_name)
        return out.getvalue(), changes
    finally:
        zin.close()


def patch_level_dat_file(path, game_mode="survival", dry_run=False):
    original = open(path, "rb").read()
    patched, changes = patch_level_dat_bytes(original, game_mode)
    if not dry_run:
        bak = path + ".bak"
        if not os.path.exists(bak):
            open(bak, "wb").write(original)
        with open(path, "wb") as f:
            f.write(patched)
    return changes


def patch_mcworld_file(in_path, game_mode="survival", dry_run=False, out_dir=None,
                       strip_behavior_packs=False):
    data = open(in_path, "rb").read()
    patched, changes = patch_mcworld_data(data, game_mode, strip_behavior_packs)
    if not dry_run:
        base, ext = os.path.splitext(in_path)
        out_name = "%s-conquistas%s" % (base, ext or ".mcworld")
        if out_dir:
            out_name = os.path.join(out_dir, os.path.basename(out_name))
        with open(out_name, "wb") as f:
            f.write(patched)
    return changes


# -------------------------------------------------------------- CLI ----------
def handle_path(p, game_mode, dry_run, out_dir, strip_behavior_packs=False):
    low = p.lower()
    if low.endswith(".mcworld") or low.endswith(".zip"):
        changes = patch_mcworld_file(p, game_mode, dry_run, out_dir, strip_behavior_packs)
        status = "OK (%d alteracoes)" % len(changes)
    elif os.path.isdir(p):
        ld = os.path.join(p, "level.dat")
        if not os.path.exists(ld):
            raise ValueError("Diretorio nao contem level.dat: %s" % p)
        changes = patch_level_dat_file(ld, game_mode, dry_run)
        status = "OK (level.dat, %d alteracoes)" % len(changes)
    elif low.endswith(".dat"):
        changes = patch_level_dat_file(p, game_mode, dry_run)
        status = "OK (%d alteracoes)" % len(changes)
    else:
        raise ValueError("Formato nao suportado: %s" % p)
    return status, changes


def collect_inputs(args):
    paths = []
    for p in args.paths:
        if os.path.isdir(p):
            found = [os.path.join(p, f) for f in sorted(os.listdir(p))
                     if f.lower().endswith((".mcworld", ".zip"))]
            if not found and os.path.exists(os.path.join(p, "level.dat")):
                paths.append(p)
            else:
                paths.extend(found)
        else:
            paths.append(p)
    return paths


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Reativa conquistas em mundos do Minecraft Bedrock.",
        epilog="Exemplos:  reativar_conquistas.py mundo.mcworld | --server 8080 | pasta/")
    ap.add_argument("paths", nargs="*", help=".mcworld, .zip, pasta de mundos ou level.dat")
    ap.add_argument("--keep-game-mode", action="store_true",
                    help="nao alterar GameType (modo de jogo padrao)")
    ap.add_argument("--check", action="store_true", help="dry-run: somente relatar")
    ap.add_argument("--out-dir", default=None, help="pasta de saida p/ .mcworld corrigidos")
    ap.add_argument("--strip-behavior-packs", action="store_true",
                    help="remove behavior packs do mundo (evita que re-bloqueiem conquistas)")
    ap.add_argument("--server", type=int, metavar="PORTA", default=None,
                    help="sobe o site local: upload de .mcworld -> download corrigido")
    ap.add_argument("--open", action="store_true", dest="open_browser",
                    help="abre o navegador automaticamente no site")
    args = ap.parse_args(argv)

    if args.server is not None:
        return run_server(args.server, keep_game_mode=args.keep_game_mode,
                          strip_behavior_packs=args.strip_behavior_packs,
                          open_browser=args.open_browser)

    game_mode = "keep" if args.keep_game_mode else "survival"
    paths = collect_inputs(args)
    if not paths:
        ap.print_help()
        return 1

    n_ok = n_chg = 0
    for p in paths:
        try:
            status, changes = handle_path(p, game_mode, args.check, args.out_dir,
                                          args.strip_behavior_packs)
            n_ok += 1
            n_chg += len(changes)
            print("[OK]     %s -> %s" % (p, status))
            for c in changes:
                print("        - %s" % c)
        except Exception as e:
            print("[ERRO]   %s -> %s: %s" % (p, type(e).__name__, e))
    print("\n%d arquivo(s) processado(s), %d alteracao(oo)." % (n_ok, n_chg))
    print("ATENCAO: o resultado so e valido se o mundo NAO tiver cheats salvos. Use Sobrevivencia.")
    return 0 if n_ok else 2


# ------------------------------------------------------ servidor web ---------
SITE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


def _read_static(url_path):
    """Resolve um caminho de URL para um arquivo dentro de site/ (anti path-traversal)."""
    rel = url_path.split("?", 1)[0].lstrip("/")
    if rel in ("", "/"):
        rel = "index.html"
    target = os.path.normpath(os.path.join(SITE_DIR, rel))
    if not target.startswith(os.path.abspath(SITE_DIR)):
        return None
    if not os.path.isfile(target):
        return None
    ext = os.path.splitext(target)[1].lower()
    with open(target, "rb") as f:
        return MIME_TYPES.get(ext, "application/octet-stream"), f.read()


def _parse_multipart(content_type, body):
    """Parseia multipart/form-data -> {campo: {"filename": str|None, "data": bytes}}."""
    m = re.search(r'boundary="?([^";\r\n]+)"?', content_type or "")
    if not m:
        return {}
    boundary = m.group(1).encode()
    parts = {}
    for raw in body.split(b"--" + boundary):
        if raw in (b"", b"\r\n", b"--\r\n"):
            continue
        header, _, payload = raw.lstrip(b"\r\n").partition(b"\r\n\r\n")
        payload = payload[:payload.rfind(b"\r\n")]
        name_m = re.search(rb'name="([^"]+)"', header)
        if not name_m:
            continue
        key = name_m.group(1).decode()
        filename = None
        fn_m = re.search(rb'filename="([^"]*)"', header)
        if fn_m:
            filename = fn_m.group(1).decode("utf-8", "replace") or None
        if filename:
            ct = re.search(rb'Content-Transfer-Encoding:\s*(\S+)', header, re.I)
            if ct and ct.group(1).lower() == b"base64":
                import base64
                payload = base64.b64decode(payload)
        parts[key] = {"filename": filename, "data": payload}
    return parts


def _open_browser(url):
    try:
        import webbrowser
        webbrowser.open(url)
    except Exception:
        pass


def _port_busy(port):
    """True se ja existe algo escutando na porta (funciona em Windows/Linux/macOS)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


# --------------------------------- cota gratis + premium + AbacatePay ----
def _store_path(name):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except Exception:
        pass
    return os.path.join(DATA_DIR, name)


def _load_json(name, default):
    try:
        with open(_store_path(name), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(name, obj):
    try:
        with open(_store_path(name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
    except Exception as e:
        sys.stderr.write("[store] falha ao salvar %s: %s\n" % (name, e))


def _client_ip(handler):
    fwd = handler.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    try:
        return handler.client_address[0]
    except Exception:
        return "unknown"


def _ip_key(ip):
    return hashlib.sha256(("rc|" + ip).encode()).hexdigest()[:32]


def is_premium_email(email):
    if not email:
        return False
    prem = _load_json("premium.json", {})
    rec = prem.get(email.strip().lower())
    if not rec:
        return False
    try:
        return time.time() < float(rec.get("until", 0))
    except Exception:
        return False


def grant_premium(email, billing_id, days=PREMIUM_DAYS):
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return 0
    prem = _load_json("premium.json", {})
    until = time.time() + days * 86400
    old = prem.get(email, {})
    try:
        if float(old.get("until", 0)) > time.time():
            until = float(old["until"]) + days * 86400
    except Exception:
        pass
    prem[email] = {"until": until, "billing_id": billing_id,
                   "granted_at": time.time()}
    _save_json("premium.json", prem)
    return until


def check_quota(ip):
    quotas = _load_json("quota.json", {})
    key = _ip_key(ip)
    now = time.time()
    uses = [t for t in quotas.get(key, []) if now - t < 7 * 86400]
    quotas[key] = uses
    _save_json("quota.json", quotas)
    return len(uses), FREE_PER_WEEK


def register_quota(ip):
    quotas = _load_json("quota.json", {})
    key = _ip_key(ip)
    now = time.time()
    uses = [t for t in quotas.get(key, []) if now - t < 7 * 86400]
    uses.append(now)
    quotas[key] = uses
    _save_json("quota.json", quotas)


def _abacate_headers():
    return {"Authorization": "Bearer " + ABACATEPAY_API_KEY,
            "Content-Type": "application/json",
            "User-Agent": "ReativaConquistas/2.0 (+https://seudominio.com.br)",
            "Accept": "application/json"}


def abacate_create_billing(name, email, base_url):
    """Cria checkout de 30 dias. Chaves abc_dev_ (v2) usam o produto do
    dashboard (ABACATEPAY_PRODUCT_ID); chaves antigas usam v1 billing."""
    if not ABACATEPAY_API_KEY:
        raise ValueError("Pagamento nao configurado no servidor.")
    if not base_url:
        base_url = "http://localhost:8080"
    base_url = base_url.rstrip("/")
    if ABACATEPAY_PRODUCT_ID:
        payload = {
            "items": [{"id": ABACATEPAY_PRODUCT_ID, "quantity": 1}],
            "returnUrl": base_url + "/",
            "completionUrl": base_url + "/sucesso.html",
            "metadata": {"email": email, "name": name, "plan": "premium30"},
            "methods": ["PIX", "CARD"],
        }
        endpoint = ABACATEPAY_BASE_V2 + "/checkouts/create"
    else:
        payload = {
            "frequency": "ONE_TIME",
            "methods": ["PIX"],
            "products": [{
                "externalId": "premium30",
                "name": PREMIUM_PRODUCT_NAME,
                "description": "VIP 30 dias: mundos gigantes + modo de jogo + foto + tempo e clima.",
                "quantity": 1,
                "price": PREMIUM_PRICE_CENTS,
            }],
            "returnUrl": base_url + "/",
            "completionUrl": base_url + "/sucesso.html",
            "metadata": {"email": email, "name": name, "plan": "premium30"},
        }
        endpoint = ABACATEPAY_BASE_V1 + "/billing/create"
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=_abacate_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")[:500]
        except Exception:
            detail = str(e)
        if "API key version mismatch" in detail and not ABACATEPAY_PRODUCT_ID:
            raise ValueError(
                "Sua chave e da API v2 (abc_dev_...): crie o produto "
                "'Premium 30 dias' no dashboard AbacatePay e configure "
                "ABACATEPAY_PRODUCT_ID no servidor. Veja o README-DEPLOY.md.")
        raise ValueError("AbacatePay recusou (%s): %s" % (e.code, detail))


def abacate_get_billing(billing_id):
    """Consulta status da cobranca. Tenta endpoints conhecidos; retorna dict normalizado."""
    if not ABACATEPAY_API_KEY:
        raise ValueError("AbacatePay nao configurado.")
    urls = [
        ABACATEPAY_BASE_V2 + "/checkouts/get?id=" + urllib.parse.quote(billing_id),
        ABACATEPAY_BASE_V1 + "/billing/get?id=" + urllib.parse.quote(billing_id),
        ABACATEPAY_BASE_V1 + "/billing/" + urllib.parse.quote(billing_id),
    ]
    last = None
    for u in urls:
        try:
            req = urllib.request.Request(u, headers=_abacate_headers(), method="GET")
            req.add_header("User-Agent", "ReativaConquistas/2.0")
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            b = data.get("data", data)
            status = str(b.get("status", "")).upper()
            meta = b.get("metadata") or {}
            cust = b.get("customer") or {}
            email = (meta.get("email") or cust.get("email") or "").lower()
            paid = status in ("PAID", "COMPLETED", "APPROVED", "ACTIVE",
                              "PAYMENT_CONFIRMED", "CONFIRMED") or "PAID" in status
            return {"raw": b, "status": status or "UNKNOWN",
                    "paid": paid, "email": email}
        except Exception as e:
            last = e
            continue
    raise ValueError("Nao consegui consultar a cobranca agora (%s)." % last)


# --------------------------------- contas, sessoes, captcha, e-mail -----
_LOCK = threading.Lock()
CAPTCHAS = {}  # captcha_id -> (resposta:int, expira:float)
RL = {}        # (ip, rota) -> [timestamps]


def _rl_allow(ip, rota, limit=10, window=60):
    """Rate-limit simples por IP/rota (anti forca-bruta e spam)."""
    now = time.time()
    with _LOCK:
        lst = [t for t in RL.get((ip, rota), []) if now - t < window]
        if len(lst) >= limit:
            RL[(ip, rota)] = lst
            return False
        lst.append(now)
        RL[(ip, rota)] = lst
        return True


def _valid_email(e):
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", (e or "").strip()))


def _hash_pw(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt.hex(), h.hex()


def _check_pw(pw, salt_hex, hash_hex):
    try:
        h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"),
                                bytes.fromhex(salt_hex), PBKDF2_ROUNDS)
        return hmac.compare_digest(h.hex(), hash_hex)
    except Exception:
        return False


def _users():
    return _load_json("users.json", {})


def _save_users(u):
    _save_json("users.json", u)


def _sessions():
    return _load_json("sessions.json", {})


def _save_sessions(s):
    _save_json("sessions.json", s)


def new_session(email):
    token = secrets.token_hex(32)
    s = _sessions()
    now = time.time()
    s = {t: r for t, r in s.items() if r.get("exp", 0) > now}
    s[token] = {"email": email, "created": now,
                "exp": now + SESSION_DAYS * 86400}
    _save_sessions(s)
    return token


def session_email(token):
    if not token:
        return ""
    r = _sessions().get(token)
    if not r or r.get("exp", 0) < time.time():
        return ""
    return r.get("email", "")


def drop_session(token):
    s = _sessions()
    s.pop(token, None)
    _save_sessions(s)


def new_captcha():
    import random
    a = random.randint(1, 9)
    b = random.randint(1, 9)
    cid = secrets.token_hex(8)
    with _LOCK:
        now = time.time()
        for k in [k for k, (_, exp) in CAPTCHAS.items() if exp < now]:
            CAPTCHAS.pop(k, None)
        CAPTCHAS[cid] = (a + b, now + 300)
    return cid, "%d + %d = ?" % (a, b)


def check_captcha(cid, answer):
    try:
        ans = int(str(answer).strip())
    except Exception:
        return False
    with _LOCK:
        rec = CAPTCHAS.pop(cid, None)
    return bool(rec and rec[1] > time.time() and rec[0] == ans)


def send_code_email(to_email, code):
    subj = "Seu codigo de verificacao — ReativaConquistas"
    body = ("Ola!\n\nSeu codigo de verificacao e: %s\n\n"
            "Valido por 10 minutos. Se nao foi voce, ignore esta mensagem.\n\n"
            "— ReativaConquistas" % code)
    if not SMTP_CONFIGURED:
        sys.stderr.write("[auth] SMTP nao configurado — codigo p/ %s: %s\n"
                         % (to_email, code))
        return False
    try:
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = subj
        msg["From"] = SMTP_FROM
        msg["To"] = to_email
        msg.set_content(body)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        return True
    except Exception as e:
        sys.stderr.write("[auth] falha SMTP: %s\n" % e)
        return False


def make_verify_code(email):
    code = "%06d" % secrets.randbelow(1000000)
    u = _users()
    rec = u.get(email, {})
    rec["code_hash"] = hashlib.sha256(code.encode()).hexdigest()
    rec["code_exp"] = time.time() + 600
    u[email] = rec
    _save_users(u)
    return code


def check_verify_code(email, code):
    u = _users()
    rec = u.get(email)
    if not rec:
        return False
    ok = (rec.get("code_hash") == hashlib.sha256(
        str(code or "").strip().encode()).hexdigest()
        and time.time() < float(rec.get("code_exp", 0)))
    if ok:
        rec["verified"] = True
        rec.pop("code_hash", None)
        rec.pop("code_exp", None)
        u[email] = rec
        _save_users(u)
    return ok


def _premium_until(email):
    if not email:
        return 0
    rec = _load_json("premium.json", {}).get(email.strip().lower())
    if not rec:
        return 0
    try:
        until = float(rec.get("until", 0))
        return until if until > time.time() else 0
    except Exception:
        return 0


def _record_history(email, entry):
    """Guarda SOMENTE metadados (nunca o mundo) — no max. 50 por conta."""
    try:
        hist = _load_json("history.json", {})
        lst = hist.get(email, [])
        lst.insert(0, entry)
        hist[email] = lst[:50]
        _save_json("history.json", hist)
    except Exception as e:
        sys.stderr.write("[hist] falha: %s\n" % e)


def run_server(port=8080, keep_game_mode=False, strip_behavior_packs=False,
               open_browser=False):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    default_mode = "keep" if keep_game_mode else "survival"

    class Handler(BaseHTTPRequestHandler):
        server_version = "ReativaConquistas/2.0"

        def log_message(self, fmt, *args):
            sys.stderr.write("[http] %s\n" % (fmt % args))

        def _send(self, code, content_type, data, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "same-origin")
            self.send_header("Permissions-Policy",
                             "camera=(), microphone=(), geolocation=(), payment=()")
            if content_type.startswith("text/html"):
                self.send_header("Content-Security-Policy", CSP_HTML)
            if self.headers.get("X-Forwarded-Proto", "http") == "https":
                self.send_header("Strict-Transport-Security",
                                 "max-age=31536000; includeSubDomains")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def _json(self, code, obj):
            payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self._send(code, "application/json; charset=utf-8", payload)

        def _base_url(self):
            if PUBLIC_BASE_URL:
                return PUBLIC_BASE_URL.rstrip("/")
            host = self.headers.get("Host", "localhost:%d" % port)
            proto = self.headers.get("X-Forwarded-Proto", "http")
            return "%s://%s" % (proto, host)

        def _same_origin(self):
            """Defesa CSRF em profundidade: chamadas de navegador (fetch do
            proprio site) trazem Origin/Referer do mesmo host. Rejeita
            divergentes; requisicoes sem cabecalho (curl, app) passam."""
            host = (self.headers.get("Host") or "").lower()
            for h in (self.headers.get("Origin"), self.headers.get("Referer")):
                if not h:
                    continue
                try:
                    ohost = urllib.parse.urlparse(h).netloc.lower()
                except Exception:
                    return False
                if ohost != host:
                    return False
            return True

        def _read_capped(self, limit=MAX_JSON_BYTES):
            try:
                n = int(self.headers.get("Content-Length", 0) or 0)
            except Exception:
                n = 0
            if n < 0 or n > limit:
                return None
            return self.rfile.read(n)

        def do_GET(self):
            path, _, qs = self.path.partition("?")
            query = urllib.parse.parse_qs(qs)
            if path == "/api/config":
                self._json(200, {
                    "free_per_week": FREE_PER_WEEK,
                    "premium_days": PREMIUM_DAYS,
                    "premium_price_cents": PREMIUM_PRICE_CENTS,
                    "abacate_configured": bool(ABACATEPAY_API_KEY),
                    "product_configured": bool(ABACATEPAY_PRODUCT_ID),
                    "smtp_configured": SMTP_CONFIGURED,
                })
                return
            if path == "/api/captcha/new":
                cid, question = new_captcha()
                self._json(200, {"id": cid, "question": question})
                return
            if path == "/api/auth/me":
                auth = self.headers.get("Authorization", "")
                token = auth[7:] if auth.startswith("Bearer ") else ""
                email = session_email(token)
                if not email:
                    self._json(401, {"error": "Sessao invalida. Entre de novo."})
                    return
                u = _users().get(email, {})
                self._json(200, {"email": email, "name": u.get("name", ""),
                                 "verified": bool(u.get("verified")),
                                 "premium_until_ms": int(_premium_until(email) * 1000)})
                return
            if path == "/api/history":
                auth = self.headers.get("Authorization", "")
                token = auth[7:] if auth.startswith("Bearer ") else ""
                email = session_email(token)
                if not email:
                    self._json(401, {"error": "Entre na sua conta para ver o historico."})
                    return
                self._json(200, {"items": _load_json("history.json", {}).get(email, [])})
                return
            if path == "/api/abacate/status":
                bid = (query.get("id") or [""])[0].strip()
                if not bid:
                    self._json(400, {"error": "Parametro 'id' obrigatorio."})
                    return
                try:
                    info = abacate_get_billing(bid)
                except Exception as e:
                    self._json(502, {"error": str(e)})
                    return
                out = {"status": info["status"], "paid": info["paid"],
                       "email": info.get("email", "")}
                if info["paid"] and info.get("email"):
                    until = grant_premium(info["email"], bid)
                    out["premium_until_ms"] = int(until * 1000)
                self._json(200, out)
                return
            static = _read_static(self.path)
            if static is None:
                self._json(404, {"error": "nao encontrado"})
                return
            content_type, data = static
            self._send(200, content_type, data)

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path.startswith("/api/") and path != "/api/abacate/webhook":
                if not self._same_origin():
                    self._json(403, {"error": "Origem invalida."})
                    return

            def _body():
                try:
                    raw = self._read_capped()
                    return json.loads(raw.decode("utf-8-sig") or "{}") if raw is not None else {}
                except Exception:
                    return {}

            def _token_email():
                auth = self.headers.get("Authorization", "")
                tok = auth[7:] if auth.startswith("Bearer ") else ""
                return tok, session_email(tok)

            if path == "/api/auth/register":
                if not _rl_allow(_client_ip(self), "register", 10, 60):
                    self._json(429, {"error": "Muitas tentativas. Aguarde 1 minuto."})
                    return
                p = _body()
                if str(p.get("website") or "").strip():
                    self._json(400, {"error": "Falha na verificacao anti-robo."})
                    return
                name = str(p.get("name", "")).strip()[:80]
                email = str(p.get("email", "")).strip().lower()[:120]
                pw = str(p.get("password", ""))
                if len(name) < 2:
                    self._json(400, {"error": "Informe seu nome."})
                    return
                if not _valid_email(email):
                    self._json(400, {"error": "Informe um e-mail valido."})
                    return
                if len(pw) < 8:
                    self._json(400, {"error": "A senha precisa de ao menos 8 caracteres."})
                    return
                if len(pw) > 128:
                    self._json(400, {"error": "A senha deve ter no maximo 128 caracteres."})
                    return
                if not check_captcha(p.get("captcha_id"), p.get("captcha")):
                    self._json(400, {"error": "Captcha incorreto. Tente de novo.",
                                     "code": "BAD_CAPTCHA"})
                    return
                users = _users()
                if email in users:
                    self._json(409, {"error": "Este e-mail ja tem conta. Faca login.",
                                     "code": "EXISTS"})
                    return
                salt, h = _hash_pw(pw)
                users[email] = {"name": name, "salt": salt, "hash": h,
                                "created": time.time(),
                                "verified": not SMTP_CONFIGURED}
                _save_users(users)
                mail_sent = False
                if SMTP_CONFIGURED:
                    mail_sent = send_code_email(email, make_verify_code(email))
                token = new_session(email)
                self._json(200, {"token": token, "email": email, "name": name,
                                 "verified": not SMTP_CONFIGURED,
                                 "mail_sent": mail_sent})
                return
            if path == "/api/auth/login":
                if not _rl_allow(_client_ip(self), "login", 10, 60):
                    self._json(429, {"error": "Muitas tentativas. Aguarde 1 minuto."})
                    return
                p = _body()
                email = str(p.get("email", "")).strip().lower()[:120]
                u = _users().get(email)
                if not u or not _check_pw(str(p.get("password", "")),
                                          u.get("salt", ""), u.get("hash", "")):
                    self._json(401, {"error": "E-mail ou senha incorretos."})
                    return
                token = new_session(email)
                self._json(200, {"token": token, "email": email,
                                 "name": u.get("name", ""),
                                 "verified": bool(u.get("verified"))})
                return
            if path == "/api/auth/logout":
                tok, _em = _token_email()
                drop_session(tok)
                self._json(200, {"ok": True})
                return
            if path == "/api/auth/logout-all":
                tok, email = _token_email()
                if not email:
                    self._json(401, {"error": "Entre na sua conta primeiro."})
                    return
                s = {t: r for t, r in _sessions().items()
                     if r.get("email") != email}
                _save_sessions(s)
                self._json(200, {"ok": True})
                return
            if path == "/api/auth/delete":
                tok, email = _token_email()
                if not email:
                    self._json(401, {"error": "Entre na sua conta primeiro."})
                    return
                u = _users().get(email)
                if not u or not _check_pw(str((_body().get("password") or "")),
                                          u.get("salt", ""), u.get("hash", "")):
                    self._json(401, {"error": "Senha incorreta. A conta nao foi excluida."})
                    return
                users = _users()
                users.pop(email, None)
                _save_users(users)
                s = {t: r for t, r in _sessions().items()
                     if r.get("email") != email}
                _save_sessions(s)
                prem = _load_json("premium.json", {})
                prem.pop(email, None)
                _save_json("premium.json", prem)
                hist = _load_json("history.json", {})
                hist.pop(email, None)
                _save_json("history.json", hist)
                sys.stderr.write("[auth] conta excluida (LGPD): %s\n"
                                 % hashlib.sha256(email.encode()).hexdigest()[:12])
                self._json(200, {"ok": True})
                return
            if path == "/api/auth/send-code":
                tok, email = _token_email()
                if not email:
                    self._json(401, {"error": "Entre na sua conta primeiro."})
                    return
                if not _rl_allow(_client_ip(self), "sendcode", 5, 300):
                    self._json(429, {"error": "Aguarde antes de pedir outro codigo."})
                    return
                code = make_verify_code(email)
                sent = send_code_email(email, code)
                self._json(200, {"sent": sent,
                                 "hint": "Codigo enviado ao e-mail." if sent
                                 else "E-mail de saida nao configurado: veja o terminal do servidor (modo teste)."})
                return
            if path == "/api/auth/verify-code":
                tok, email = _token_email()
                if not email:
                    self._json(401, {"error": "Entre na sua conta primeiro."})
                    return
                if check_verify_code(email, str((_body().get("code") or ""))):
                    self._json(200, {"ok": True, "verified": True})
                else:
                    self._json(400, {"error": "Codigo invalido ou expirado."})
                return
            if path == "/api/abacate/create":
                tok, email = _token_email()
                if not email:
                    self._json(401, {"error": "Crie sua conta (ou entre) antes de pagar.",
                                     "code": "LOGIN_REQUIRED"})
                    return
                u = _users().get(email, {})
                if not u.get("verified"):
                    self._json(403, {"error": "Confirme seu e-mail com o codigo antes de pagar.",
                                     "code": "VERIFY_REQUIRED"})
                    return
                name = u.get("name", "")
                self._read_capped()
                try:
                    resp = abacate_create_billing(name, email, self._base_url())
                except Exception as e:
                    self._json(502, {"error": str(e)})
                    return
                data = resp.get("data", resp)
                url = data.get("url")
                bid = data.get("id")
                if not url:
                    self._json(502, {"error": "AbacatePay nao retornou URL de pagamento."})
                    return
                # anexa o id p/ a pagina de sucesso verificar
                sep = "&" if "?" in url else "?"
                # guardamos mapeamento simples p/ webhook tardio
                pend = _load_json("pending.json", {})
                pend[str(bid)] = {"email": email, "name": name, "at": time.time()}
                _save_json("pending.json", pend)
                self._json(200, {"url": url, "id": bid})
                return
            if path == "/api/abacate/webhook":
                # Segredo opcional: se configurado, exige ?secret= correto.
                if ABACATEPAY_WEBHOOK_SECRET:
                    qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]
                                               if "?" in self.path else "")
                    if (qs.get("secret") or [""])[0] != ABACATEPAY_WEBHOOK_SECRET:
                        self._json(403, {"error": "forbidden"})
                        return
                raw = self._read_capped()
                if raw is None:
                    self._json(413, {"error": "corpo grande demais"})
                    return
                try:
                    evt = json.loads(raw.decode("utf-8-sig") or "{}")
                except Exception:
                    evt = {}
                try:
                    data = evt.get("data", evt)
                    billing = data.get("billing", data)
                    bid = str(billing.get("id", data.get("id", "")))
                    if not bid:
                        sys.stderr.write("[pay] webhook sem id: ignorado\n")
                    else:
                        # NUNCA confia no POST sozinho: reconfere na AbacatePay.
                        info = abacate_get_billing(bid)
                        email = (info.get("email") or "").lower()
                        if not email:
                            pend = _load_json("pending.json", {})
                            email = str((pend.get(bid) or {}).get("email", "")).lower()
                        if info.get("paid") and email:
                            grant_premium(email, bid)
                            sys.stderr.write("[pay] premium liberado: %s (%s)\n" % (email, bid))
                        else:
                            sys.stderr.write("[pay] webhook nao-pago: %s (%s)\n" % (email, bid))
                except Exception as e:
                    sys.stderr.write("[pay] webhook erro: %s\n" % e)
                self._json(200, {"ok": True})
                return
            if path not in ("/api/fix", "/"):
                self._json(404, {"error": "rota desconhecida"})
                return
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length > MAX_UPLOAD_BYTES + 8 * 1024 * 1024:
                self._json(413, {"error": "Arquivo grande demais (max. %d MB)." % (MAX_UPLOAD_BYTES // (1024 * 1024))})
                return
            body = self.rfile.read(length)
            fields = _parse_multipart(self.headers.get("Content-Type"), body)
            file_field = fields.get("mcworld")
            if not file_field or not file_field["data"]:
                self._json(400, {"error": "Campo 'mcworld' nao enviado."})
                return
            if len(file_field["data"]) > MAX_UPLOAD_BYTES:
                self._json(413, {"error": "Arquivo grande demais (max. %d MB)." % (MAX_UPLOAD_BYTES // (1024 * 1024))})
                return
            if not fields.get("accept_terms", {}).get("data"):
                # aceita tambem via campo texto simples
                pass  # o frontend exige; aqui toleramos p/ compatibilidade CLI
            premium_email = ""
            try:
                premium_email = fields.get("premium_email", {}).get("data", b"").decode("utf-8", "replace").strip().lower()
            except Exception:
                premium_email = ""
            # Conta logada tem prioridade sobre o campo avulso:
            _tok, _tok_email = _token_email()
            if _tok_email:
                premium_email = _tok_email
            premium = is_premium_email(premium_email)
            # modo de jogo: free sempre survival; premium pode escolher
            gm_raw = b""
            try:
                gm_raw = fields.get("game_mode", {}).get("data", b"")
                if isinstance(gm_raw, bytes):
                    gm_raw = gm_raw.decode("utf-8", "replace")
            except Exception:
                gm_raw = ""
            want_mode = str(gm_raw or default_mode).lower()
            if want_mode not in ("survival", "creative", "keep"):
                want_mode = default_mode
            if want_mode == "creative" and not premium:
                self._json(402, {"code": "PREMIUM_REQUIRED",
                                 "error": "Deixar no Criativo e funcao Premium."})
                return
            strip_field = fields.get("strip", {}).get("data")
            strip = strip_behavior_packs or strip_field in (b"1", b"on", b"true")
            if strip and not premium:
                self._json(402, {"code": "PREMIUM_REQUIRED",
                                 "error": "Remover behavior packs e funcao Premium."})
                return
            icon_bytes = None
            icon_field = fields.get("icon")
            if icon_field and icon_field.get("data"):
                if not premium:
                    self._json(402, {"code": "PREMIUM_REQUIRED",
                                     "error": "Trocar a foto do mundo e funcao Premium."})
                    return
                icon_bytes = icon_field["data"]
                if len(icon_bytes) > 5 * 1024 * 1024:
                    self._json(400, {"error": "Icone grande demais (max. 5 MB)."})
                    return
                if icon_bytes[:8:1][:4] not in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"\xff\xd8\xff\xdb", b"RIFF"):
                    # validacao leve: aceita PNG/JPG/WebP pelo magic
                    if not (icon_bytes[:4] == b"\x89PNG" or icon_bytes[:2] == b"\xff\xd8" or icon_bytes[:4] == b"RIFF"):
                        self._json(400, {"error": "Icone invalido: envie PNG ou JPG."})
                        return
            new_name = ""
            try:
                _nm = fields.get("world_name", {}).get("data", b"")
                if isinstance(_nm, bytes):
                    _nm = _nm.decode("utf-8", "replace")
                new_name = " ".join(str(_nm or "").split())[:60]
            except Exception:
                new_name = ""
            if new_name and not premium:
                self._json(402, {"code": "PREMIUM_REQUIRED",
                                 "error": "Renomear o mundo e funcao Premium."})
                return
            if not premium:
                used, limit = check_quota(_client_ip(self))
                if used >= limit:
                    self._json(402, {"code": "QUOTA_EXCEEDED",
                                     "error": "Sua conversao gratis desta semana ja foi usada. O Premium e ilimitado."})
                    return
            try:
                patched, changes = patch_mcworld_data(
                    file_field["data"], want_mode, strip, icon_bytes,
                    world_name=new_name or None)
            except Exception as e:
                self._json(400, {"error": "Falha ao corrigir: %s" % e})
                return
            if not premium:
                register_quota(_client_ip(self))
            if premium_email:
                try:
                    _orig = (file_field.get("filename") or "mundo.mcworld")[:80]
                except Exception:
                    _orig = "mundo.mcworld"
                _record_history(premium_email, {
                    "at": time.time(), "file": _orig,
                    "size": len(file_field["data"]), "mode": want_mode,
                    "strip": bool(strip), "icon": bool(icon_bytes),
                    "rename": bool(new_name),
                })
            # log anonimo minimo (Marco Civil)
            try:
                sys.stderr.write("[fix] ok ip=%s premium=%s mode=%s strip=%s icon=%s bytes=%d\n" % (
                    _ip_key(_client_ip(self))[:12], premium, want_mode,
                    bool(strip), bool(icon_bytes), len(patched)))
            except Exception:
                pass
            self._send(200, "application/octet-stream", patched, {
                "Content-Disposition": 'attachment; filename="mundo-conquistas.mcworld"',
                "X-Changes": str(len(changes)),
            })

    if _port_busy(port):
        print("Porta %d ja esta em uso — abrindo o site que ja esta rodando." % port)
        if open_browser:
            _open_browser("http://localhost:%d/" % port)
        return 0

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)

    url = "http://localhost:%d/" % port
    print("ReativaConquistas no ar: %s" % url)
    print("Aguarde os uploads (Ctrl+C para parar)...")
    if open_browser:
        _open_browser(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)