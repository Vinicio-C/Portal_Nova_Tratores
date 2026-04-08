import { NextRequest, NextResponse } from "next/server";
import { syncClientes, syncProjetos, syncProdutos } from "@/lib/pos/sync-omie";

const CRON_SECRET = process.env.CRON_SECRET || "";

async function executarSync() {
  const resultados: Record<string, unknown> = {};
  const erros: string[] = [];

  try {
    resultados.clientes = await syncClientes();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    erros.push(`Clientes: ${msg}`);
    console.error("Erro sync clientes:", msg);
  }

  try {
    resultados.projetos = await syncProjetos();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    erros.push(`Projetos: ${msg}`);
    console.error("Erro sync projetos:", msg);
  }

  try {
    resultados.produtos = await syncProdutos();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    erros.push(`Produtos: ${msg}`);
    console.error("Erro sync produtos:", msg);
  }

  return {
    sucesso: erros.length === 0,
    resultados,
    erros: erros.length > 0 ? erros : undefined,
    timestamp: new Date().toISOString(),
  };
}

// POST — chamado pelo botão manual do frontend
export async function POST(req: NextRequest) {
  const isManual = req.headers.get("x-sync-manual") === "true";
  const authHeader = req.headers.get("authorization") || "";
  const isFromCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isManual && !isFromCron) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  // Permite sync individual por tipo (para barra de progresso no frontend)
  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo");

  if (tipo === "clientes") {
    try {
      const r = await syncClientes();
      return NextResponse.json({ sucesso: true, resultado: r });
    } catch (err) {
      return NextResponse.json({ sucesso: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }
  if (tipo === "projetos") {
    try {
      const r = await syncProjetos();
      return NextResponse.json({ sucesso: true, resultado: r });
    } catch (err) {
      return NextResponse.json({ sucesso: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }
  if (tipo === "produtos") {
    try {
      const r = await syncProdutos();
      return NextResponse.json({ sucesso: true, resultado: r });
    } catch (err) {
      return NextResponse.json({ sucesso: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  const resultado = await executarSync();
  return NextResponse.json(resultado);
}

// GET — para Railway Cron Job (configura no painel do Railway)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const isFromCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  // Permite sem auth se vier do mesmo servidor (Railway internal)
  const isInternal = req.headers.get("x-railway-cron") === "true";

  if (!isFromCron && !isInternal) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const resultado = await executarSync();
  return NextResponse.json(resultado);
}
