import { NextRequest, NextResponse } from "next/server";
import { geocodificar, rotaDaOficina, OFICINA } from "@/lib/pos/ors";
import { supabase } from "@/lib/pos/supabase";

/** Busca todos os endereços disponíveis para um cliente */
async function buscarEnderecos(cnpj: string, enderecoOS: string, cidadeOS: string) {
  const enderecos: { label: string; fonte: string; endereco: string }[] = [];

  if (cnpj) {
    const cnpjLimpo = String(cnpj).replace(/\D/g, "");

    // Omie
    const { data: clienteOmie } = await supabase
      .from("Clientes")
      .select("endereco, cidade, bairro, cep, estado, numero, cnpj_cpf")
      .or(`cnpj_cpf.eq.${cnpjLimpo},cnpj_cpf.eq.${cnpj}`)
      .limit(1);

    if (clienteOmie && clienteOmie.length > 0) {
      const c = clienteOmie[0] as Record<string, string>;
      const parts = [c.endereco, c.numero, c.bairro, c.cidade, c.estado, c.cep].filter(Boolean);
      const end = parts.join(", ");
      if (end) enderecos.push({ label: "Omie", fonte: "Omie", endereco: end });
    }

    // Cliente Manual
    const { data: clienteManual } = await supabase
      .from("Clientes_Manuais")
      .select("Cli_Endereco, Cli_Cidade, Cli_Cpf_Cnpj")
      .or(`Cli_Cpf_Cnpj.eq.${cnpjLimpo},Cli_Cpf_Cnpj.eq.${cnpj}`)
      .limit(1);

    if (clienteManual && clienteManual.length > 0) {
      const c = clienteManual[0] as Record<string, string>;
      const end = [c.Cli_Endereco, c.Cli_Cidade].filter(Boolean).join(", ");
      if (end) enderecos.push({ label: "Cliente Manual", fonte: "Manual", endereco: end });
    }
  }

  // Endereço da OS
  if (enderecoOS || cidadeOS) {
    let end = "";
    if (enderecoOS && cidadeOS && enderecoOS.toLowerCase().includes(cidadeOS.toLowerCase().replace(/\s*\(.*\)/, ''))) {
      end = enderecoOS;
    } else {
      end = [enderecoOS, cidadeOS].filter(Boolean).join(", ");
    }
    if (end) {
      // Só adicionar se for diferente dos que já tem
      const jaTem = enderecos.some(e => e.endereco.toLowerCase() === end.toLowerCase());
      if (!jaTem) enderecos.push({ label: "OS", fonte: "OS", endereco: end });
    }
  }

  return enderecos;
}

export async function POST(req: NextRequest) {
  const { cnpj, endereco, cidade, qtdHoras, enderecoManual } = await req.json();

  // Buscar todos os endereços disponíveis
  const enderecosDisponiveis = await buscarEnderecos(cnpj, endereco, cidade);

  // Se tem endereço manual (editado pelo usuário), usa direto
  // Senão, tenta cada endereço disponível até conseguir geocodificar
  let enderecoCompleto = "";
  let fonte = "";
  let coords: { lat: number; lng: number } | null = null;

  if (enderecoManual) {
    enderecoCompleto = enderecoManual;
    fonte = "Editado";
    coords = await geocodificar(enderecoCompleto + ", Brasil");
  } else {
    for (const opt of enderecosDisponiveis) {
      coords = await geocodificar(opt.endereco + ", Brasil");
      if (coords) {
        enderecoCompleto = opt.endereco;
        fonte = opt.fonte;
        break;
      }
    }
  }

  if (!enderecoCompleto) {
    return NextResponse.json({ erro: "Endereço do cliente não encontrado", enderecosDisponiveis }, { status: 400 });
  }

  if (!coords) {
    const orsKey = process.env.ORS_API_KEY || process.env.NEXT_PUBLIC_ORS_API_KEY || "";
    return NextResponse.json({ erro: `Não foi possível localizar o endereço. ${orsKey ? "" : "Chave ORS não configurada."}`, enderecosDisponiveis }, { status: 400 });
  }

  // Calcular rota da oficina até o cliente (ida)
  const rotaIda = await rotaDaOficina(coords.lat, coords.lng);
  if (!rotaIda) {
    return NextResponse.json({ erro: "Não foi possível calcular a rota", enderecosDisponiveis }, { status: 400 });
  }

  // Calcular tempo total (ida = volta)
  const horasServico = parseFloat(qtdHoras || 0);
  const tempoServicoMin = horasServico * 60;
  const tempoTotalMin = rotaIda.tempo_min + tempoServicoMin + rotaIda.tempo_min;
  const tempoTotalHoras = Math.round((tempoTotalMin / 60) * 10) / 10;

  return NextResponse.json({
    enderecoUsado: enderecoCompleto,
    fonte,
    enderecosDisponiveis,
    coordenadas: coords,
    oficina: OFICINA,
    ida: {
      distancia_km: rotaIda.distancia_km,
      tempo_min: rotaIda.tempo_min,
    },
    volta: {
      distancia_km: rotaIda.distancia_km,
      tempo_min: rotaIda.tempo_min,
    },
    servico: {
      horas: horasServico,
      tempo_min: tempoServicoMin,
    },
    total: {
      tempo_min: tempoTotalMin,
      tempo_horas: tempoTotalHoras,
      distancia_total_km: rotaIda.distancia_km * 2,
    },
  });
}
