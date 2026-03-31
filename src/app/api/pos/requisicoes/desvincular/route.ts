import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/pos/supabase";

export async function POST(req: NextRequest) {
  const { reqId, justificativa, usuario } = await req.json();

  if (!reqId || !justificativa?.trim()) {
    return NextResponse.json({ success: false, erro: "ID e justificativa são obrigatórios." }, { status: 400 });
  }

  const { error } = await supabase
    .from("Requisicao")
    .update({
      ordem_servico: null,
      desvinculado_justificativa: justificativa.trim(),
      desvinculado_por: usuario || "Admin",
      desvinculado_em: new Date().toISOString(),
    })
    .eq("id", reqId);

  if (error) {
    return NextResponse.json({ success: false, erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
