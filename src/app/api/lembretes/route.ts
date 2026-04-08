import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TBL = "portal_lembretes";

/** GET — busca lembretes do usuário */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const tipo = searchParams.get("tipo"); // "pendentes" | "todos" | "vencidos"

  if (!userId) return NextResponse.json({ erro: "userId obrigatório" }, { status: 400 });

  let query = supabase
    .from(TBL)
    .select("*")
    .or(`criador_id.eq.${userId},destinatario_id.eq.${userId}`)
    .order("data_hora", { ascending: true });

  if (tipo === "pendentes") {
    query = query.eq("status", "pendente");
  } else if (tipo === "vencidos") {
    query = query.eq("status", "pendente").lte("data_hora", new Date().toISOString());
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/** POST — criar lembrete */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { criador_id, criador_nome, destinatario_id, destinatario_nome, titulo, descricao, data_hora } = body;

  if (!criador_id || !destinatario_id || !titulo || !data_hora) {
    return NextResponse.json({ erro: "Campos obrigatórios: criador_id, destinatario_id, titulo, data_hora" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from(TBL)
    .insert({
      criador_id,
      criador_nome,
      destinatario_id,
      destinatario_nome,
      titulo,
      descricao: descricao || "",
      data_hora,
      status: "pendente",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** PATCH — atualizar lembrete (concluir ou adiar) */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, data_hora } = body;

  if (!id) return NextResponse.json({ erro: "id obrigatório" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (data_hora) updates.data_hora = data_hora;

  const { data, error } = await supabase
    .from(TBL)
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
