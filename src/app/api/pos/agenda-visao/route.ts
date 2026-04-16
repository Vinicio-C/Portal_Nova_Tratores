import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/pos/supabase";
import { buscarEnderecos } from "@/lib/pos/enderecos";
import { geocodificar, rotaDaOficina, calcularRota, OFICINA } from "@/lib/pos/ors";

const TBL = "agenda_visao";

/** GET — busca agenda do dia */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const data = searchParams.get("data") || new Date().toISOString().split("T")[0];
  const tecnico = searchParams.get("tecnico");

  let query = supabase.from(TBL).select("*").eq("data", data).order("ordem_sequencia");
  if (tecnico) query = query.eq("tecnico_nome", tecnico);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(rows || []);
}

/** POST — sync rápido: salva dados básicos das ordens SEM chamar ORS */
export async function POST(req: NextRequest) {
  const { data: dataStr, tecnicos } = await req.json();

  if (!dataStr || !Array.isArray(tecnicos)) {
    return NextResponse.json({ erro: "data e tecnicos obrigatórios" }, { status: 400 });
  }

  const toInsert: any[] = [];

  for (const tec of tecnicos) {
    // Buscar existentes de uma vez
    const { data: existentes } = await supabase
      .from(TBL)
      .select("id_ordem, id, qtd_horas")
      .eq("data", dataStr)
      .eq("tecnico_nome", tec.nome);

    const existentesMap = new Map((existentes || []).map((e: any) => [e.id_ordem, e]));

    let seq = existentesMap.size;
    for (const o of tec.ordens) {
      const horasOS = parseFloat(String(o.qtdHoras || 0)) || 2;
      const existente = existentesMap.get(o.id);
      if (existente) {
        // Atualizar qtd_horas se mudou na OS
        if (existente.qtd_horas !== horasOS) {
          await supabase.from(TBL).update({ qtd_horas: horasOS }).eq("id", existente.id);
        }
        continue;
      }

      toInsert.push({
        data: dataStr,
        tecnico_nome: tec.nome,
        id_ordem: o.id,
        cliente: o.cliente || "",
        servico: o.servico || "",
        endereco: o.endereco || "",
        cidade: o.cidade || "",
        endereco_opcoes: [],
        coordenadas: null,
        tempo_ida_min: 0,
        distancia_ida_km: 0,
        tempo_volta_min: 0,
        distancia_volta_km: 0,
        qtd_horas: horasOS,
        hora_inicio: o.horaInicio || "",
        hora_fim: o.horaFim || "",
        ordem_sequencia: seq,
        status: "pendente",
        observacoes: o.observacoes || "",
      });
      seq++;
    }

    // Limpar ordens que saíram de "Execução" (stale records)
    const ordensAtuais = tec.ordens.map((o: any) => o.id);
    if (existentes && existentes.length > 0) {
      const idsRemover = existentes
        .filter((e: any) => !ordensAtuais.includes(e.id_ordem))
        .map((e: any) => e.id);
      if (idsRemover.length > 0) {
        await supabase.from(TBL).delete().in("id", idsRemover);
      }
    }
  }

  if (toInsert.length > 0) {
    const { error: insertErr } = await supabase.from(TBL).insert(toInsert);
    if (insertErr) {
      console.error("[agenda-visao] Erro insert:", insertErr.message, "| payload sample:", JSON.stringify(toInsert[0]));
      return NextResponse.json({ erro: insertErr.message }, { status: 500 });
    }
  }

  // Retorna tudo do dia
  const { data: rows, error: selErr } = await supabase
    .from(TBL).select("*").eq("data", dataStr).order("ordem_sequencia");

  if (selErr) {
    console.error("[agenda-visao] Erro select:", selErr.message);
    return NextResponse.json({ erro: selErr.message }, { status: 500 });
  }

  return NextResponse.json(rows || []);
}

/** PATCH — atualiza item. Se manda calcular=true, faz geocode+rota */
export async function PATCH(req: NextRequest) {
  const dados = await req.json();
  const { id, calcular, ...campos } = dados;

  if (!id) return NextResponse.json({ erro: "id obrigatório" }, { status: 400 });

  // Calcular rotas (chamado pelo frontend para cada row)
  if (calcular) {
    // Buscar row atual para pegar cnpj/endereco/cidade
    const { data: row } = await supabase.from(TBL).select("*").eq("id", id).single();
    if (!row) return NextResponse.json({ erro: "não encontrado" }, { status: 404 });

    const opcoes = await buscarEnderecos(row.cnpj || "", row.endereco || "", row.cidade || "");

    let coordenadas: { lat: number; lng: number } | null = null;
    let enderecoUsado = row.endereco || "";
    let tempoIda = 0, distIda = 0, tempoVolta = 0, distVolta = 0;

    // Origem customizada (última localização do técnico) ou oficina
    const origemLat = campos.origemLat as number | undefined;
    const origemLng = campos.origemLng as number | undefined;
    const usarOrigem = origemLat && origemLng;

    for (const opt of opcoes) {
      coordenadas = await geocodificar(opt.endereco + ", Brasil");
      if (coordenadas) {
        enderecoUsado = opt.endereco;
        // Ida: da origem customizada ou da oficina
        const rotaIda = usarOrigem
          ? await calcularRota(origemLat, origemLng, coordenadas.lat, coordenadas.lng)
          : await rotaDaOficina(coordenadas.lat, coordenadas.lng);
        if (rotaIda) {
          tempoIda = rotaIda.tempo_min;
          distIda = rotaIda.distancia_km;
        }
        // Volta: sempre da oficina
        const rotaVolta = await rotaDaOficina(coordenadas.lat, coordenadas.lng);
        if (rotaVolta) {
          tempoVolta = rotaVolta.tempo_min;
          distVolta = rotaVolta.distancia_km;
        }
        break;
      }
    }

    const { data: updated, error } = await supabase.from(TBL).update({
      endereco: enderecoUsado,
      endereco_opcoes: opcoes,
      coordenadas,
      tempo_ida_min: tempoIda,
      distancia_ida_km: distIda,
      tempo_volta_min: tempoVolta,
      distancia_volta_km: distVolta,
      updated_at: new Date().toISOString(),
    }).eq("id", id).select().single();

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json(updated);
  }

  // Edição manual de endereço — recalcular rota
  if (campos.endereco) {
    const coords = await geocodificar(campos.endereco + ", Brasil");
    if (coords) {
      campos.coordenadas = coords;
      const rota = await rotaDaOficina(coords.lat, coords.lng);
      if (rota) {
        campos.tempo_ida_min = rota.tempo_min;
        campos.distancia_ida_km = rota.distancia_km;
        campos.tempo_volta_min = rota.tempo_min;
        campos.distancia_volta_km = rota.distancia_km;
      }
    }
  }

  campos.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from(TBL).update(campos).eq("id", id).select().single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** DELETE — remove item */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ erro: "id obrigatório" }, { status: 400 });

  const { error } = await supabase.from(TBL).delete().eq("id", id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
