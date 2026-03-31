#!/usr/bin/env python3
"""Divisor de despesas de viagem à Madeira para 2 pessoas."""

def main():
    print("=" * 50)
    print("  Divisor de Despesas - Viagem à Madeira")
    print("=" * 50)

    pessoa1 = input("\nNome da pessoa 1: ").strip()
    pessoa2 = input("Nome da pessoa 2: ").strip()

    despesas = []

    print(f"\nAdicione despesas (quem pagou, descrição, valor).")
    print("Digite 'fim' para calcular.\n")

    while True:
        entrada = input("Quem pagou? (1={}, 2={}, fim): ".format(pessoa1, pessoa2)).strip().lower()
        if entrada == "fim":
            break
        if entrada not in ("1", "2"):
            print("  Opção inválida. Use 1, 2 ou fim.")
            continue

        pagador = pessoa1 if entrada == "1" else pessoa2
        descricao = input("  Descrição: ").strip()
        try:
            valor = float(input("  Valor (€): ").replace(",", "."))
        except ValueError:
            print("  Valor inválido, despesa ignorada.")
            continue

        despesas.append({"pagador": pagador, "descricao": descricao, "valor": valor})
        print(f"  ✓ {descricao}: €{valor:.2f} pago por {pagador}\n")

    if not despesas:
        print("\nNenhuma despesa registada.")
        return

    # Calcular totais
    total = sum(d["valor"] for d in despesas)
    total_p1 = sum(d["valor"] for d in despesas if d["pagador"] == pessoa1)
    total_p2 = sum(d["valor"] for d in despesas if d["pagador"] == pessoa2)
    metade = total / 2

    # Resumo
    print("\n" + "=" * 50)
    print("  RESUMO DAS DESPESAS")
    print("=" * 50)

    for d in despesas:
        print(f"  {d['descricao']:.<30} €{d['valor']:>8.2f}  ({d['pagador']})")

    print("-" * 50)
    print(f"  Total:                        €{total:>8.2f}")
    print(f"  {pessoa1} pagou:               €{total_p1:>8.2f}")
    print(f"  {pessoa2} pagou:               €{total_p2:>8.2f}")
    print(f"  Cada um deve (metade):        €{metade:>8.2f}")

    print("\n" + "=" * 50)
    print("  ACERTO FINAL")
    print("=" * 50)

    diferenca = abs(total_p1 - total_p2) / 2

    if total_p1 > total_p2:
        print(f"\n  {pessoa2} deve pagar €{diferenca:.2f} a {pessoa1}")
    elif total_p2 > total_p1:
        print(f"\n  {pessoa1} deve pagar €{diferenca:.2f} a {pessoa2}")
    else:
        print("\n  Estão quites! Ninguém deve nada.")

    print()


if __name__ == "__main__":
    main()
