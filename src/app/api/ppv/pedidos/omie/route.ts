import { NextRequest, NextResponse } from "next/server";
import { enviarPPVParaOmie } from "@/lib/ppv/omie";
import { logAndNotify } from "@/lib/server/audit-notify";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body?.id;
    const userName = body?.userName || "Sistema";

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "ID do PPV obrigatório" }, { status: 400 });
    }

    const resultado = await enviarPPVParaOmie(id);

    if (!resultado.sucesso) {
      return NextResponse.json({ error: resultado.erro }, { status: 400 });
    }

    await logAndNotify({
      userName, sistema: "ppv", acao: "enviar_omie",
      entidade: "pedido", entidadeId: id, entidadeLabel: `PPV ${id}`,
      detalhes: { numeroPedido: resultado.numeroPedido },
      notifTitulo: `PPV ${id} enviada para Omie`,
      notifDescricao: `${userName} enviou PPV ${id} para Omie (PV nº ${resultado.numeroPedido})`,
      notifLink: `/ppv?id=${id}`,
    });

    return NextResponse.json({
      success: true,
      numeroPedido: resultado.numeroPedido,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    console.error("[API pedidos/omie]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
