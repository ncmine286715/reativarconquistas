#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera códigos Kiwify offline (segredo SÓ seu, nunca sobe pro site).
Uso:
  py -3 gerar_codigos.py M 20        -> 20 códigos Premium 30 dias
  py -3 gerar_codigos.py V 20        -> 20 vitalícios
  py -3 gerar_codigos.py A 50        -> 50 avulsos 1 uso
Tipos: A=avulsa 1 uso | M=30 dias | V=vitalício
Formato: RC-XXXX-XXXX-XXXX (compatível com site/codes.js)
"""
import sys, secrets, hashlib

ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
SECRET = "troque-isso-por-um-segredo-seu-8f3ka9"  # <-- TROQUE e use o MESMO em site/codes.js

def checksum(typech, rand):
    h = hashlib.sha256((typech + rand + SECRET).encode()).hexdigest()
    out = ""
    for i in range(4):
        b = int(h[i*2:i*2+2], 16)
        # ALPH tem 31 chars (letras sem I,L,O + dígitos sem 0,1): índice 31 dobra p/ 0.
        # Usar "% 31" direto mudaria todos os checksums e invalidaria códigos já vendidos.
        out += ALPH[(b % 32) % len(ALPH)]
    return out

def gen_one(typech):
    rand7 = "".join(secrets.choice(ALPH) for _ in range(7))
    rand = typech + rand7
    chk = checksum(typech, rand)
    raw = rand + chk
    return "RC-%s-%s-%s" % (raw[0:4], raw[4:8], raw[8:12])

def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("A", "M", "V"):
        print("Uso: gerar_codigos.py [A|M|V] [qtd]")
        return 1
    t, n = sys.argv[1], int(sys.argv[2])
    if SECRET.startswith("troque-isso"):
        print("AVISO: troque o SECRET no .py e no site/codes.js antes de vender!")
    codes = [gen_one(t) for _ in range(n)]
    with open("codigos_%s.txt" % t, "w", encoding="utf-8") as f:
        f.write("\n".join(codes) + "\n")
    print("\n".join(codes))
    print("\nSalvo em codigos_%s.txt (NÃO commite, NÃO suba pro GitHub)." % t)

if __name__ == "__main__":
    sys.exit(main())
