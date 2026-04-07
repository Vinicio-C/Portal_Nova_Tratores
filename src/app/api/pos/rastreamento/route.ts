import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.ROTAEXATA_API_URL || 'https://api.rotaexata.com.br'
const EMAIL = process.env.ROTAEXATA_EMAIL || ''
const PASSWORD = process.env.ROTAEXATA_PASSWORD || ''

// Coordenadas da loja (Nova Tratores - Piraju/SP — baseado no estacionamento GPS dos veículos)
const LOJA_LAT = -23.2085
const LOJA_LNG = -49.3710
const RAIO_LOJA_KM = 0.8 // 800m de raio

let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Login Rota Exata falhou: ${res.status}`)
  const data = await res.json()
  if (!data.token) throw new Error('Login Rota Exata: token não retornado')
  tokenCache = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

// Fetch genérico — retorna null em vez de throw no 404 (sem registros)
async function fetchRotaExata(endpoint: string, params?: Record<string, string>): Promise<any> {
  const token = await getToken()
  let url = `${API_URL}${endpoint}`
  if (params) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    url += `?${qs}`
  }
  const res = await fetch(url, { headers: { Authorization: token } })

  if (res.status === 404) return { data: [] }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Rota Exata ${endpoint}: ${res.status} - ${text}`)
  }
  return res.json()
}

// Haversine
function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function naLoja(lat: number, lng: number): boolean {
  return distanciaKm(lat, lng, LOJA_LAT, LOJA_LNG) <= RAIO_LOJA_KM
}

interface Posicao {
  dt_posicao: string; latitude: number; longitude: number
  velocidade: number; ignicao: number; adesao_id: number
  adesao?: { vei_placa?: string; vei_descricao?: string }
}

interface Evento {
  tipo: 'saida_loja' | 'chegada_cliente' | 'saida_cliente' | 'retorno_loja' | 'parada' | 'inicio_movimento'
  horario: string; lat: number; lng: number; na_loja: boolean
}

interface Viagem {
  adesao_id: number; placa: string; descricao: string; data: string
  saida_loja: string | null; chegada_cliente: string | null
  saida_cliente: string | null; retorno_loja: string | null
  eventos: Evento[]; posicoes_total: number
  ultima_posicao: { dt: string; lat: number; lng: number; ignicao: number; velocidade: number } | null
}

const DEBOUNCE_MIN = 3 // Ignora mudanças de ignição em menos de 3 minutos

function detectarViagens(posicoes: Posicao[]): Viagem[] {
  if (posicoes.length === 0) return []
  const sorted = [...posicoes].sort((a, b) =>
    new Date(a.dt_posicao).getTime() - new Date(b.dt_posicao).getTime()
  )

  // Agrupar por dia
  const porDia: Record<string, Posicao[]> = {}
  for (const p of sorted) {
    const dia = p.dt_posicao.split('T')[0]
    if (!porDia[dia]) porDia[dia] = []
    porDia[dia].push(p)
  }

  const adesaoId = sorted[0].adesao_id
  const placa = sorted[0].adesao?.vei_placa || ''
  const descricao = sorted[0].adesao?.vei_descricao || ''

  const viagens: Viagem[] = []

  for (const [dia, posDia] of Object.entries(porDia)) {
    if (posDia.length < 2) continue
    const last = posDia[posDia.length - 1]

    const eventos: Evento[] = []
    let prevIgnicao = posDia[0].ignicao
    let prevNaLoja = naLoja(posDia[0].latitude, posDia[0].longitude)
    let ultimoEventoTs = 0
    let saiuDaLoja = false
    let estaNoCliente = false

    for (let i = 1; i < posDia.length; i++) {
      const pos = posDia[i]
      const ts = new Date(pos.dt_posicao).getTime()
      const estaNaLoja = naLoja(pos.latitude, pos.longitude)
      const ignicaoLigou = pos.ignicao === 1 && prevIgnicao === 0
      const ignicaoDesligou = pos.ignicao === 0 && prevIgnicao === 1
      const debounceOk = (ts - ultimoEventoTs) > DEBOUNCE_MIN * 60 * 1000

      if (!saiuDaLoja && prevNaLoja && !estaNaLoja && pos.velocidade > 0) {
        eventos.push({ tipo: 'saida_loja', horario: pos.dt_posicao, lat: pos.latitude, lng: pos.longitude, na_loja: false })
        saiuDaLoja = true; ultimoEventoTs = ts
      }
      if (!saiuDaLoja && ignicaoLigou && !estaNaLoja) {
        saiuDaLoja = true
      }
      if (saiuDaLoja && !estaNoCliente && ignicaoDesligou && !estaNaLoja && debounceOk) {
        eventos.push({ tipo: 'chegada_cliente', horario: pos.dt_posicao, lat: pos.latitude, lng: pos.longitude, na_loja: false })
        estaNoCliente = true; ultimoEventoTs = ts
      }
      if (estaNoCliente && ignicaoLigou && !estaNaLoja && debounceOk) {
        eventos.push({ tipo: 'saida_cliente', horario: pos.dt_posicao, lat: pos.latitude, lng: pos.longitude, na_loja: false })
        estaNoCliente = false; ultimoEventoTs = ts
      }
      if (saiuDaLoja && !prevNaLoja && estaNaLoja) {
        eventos.push({ tipo: 'retorno_loja', horario: pos.dt_posicao, lat: pos.latitude, lng: pos.longitude, na_loja: true })
        saiuDaLoja = false; estaNoCliente = false; ultimoEventoTs = ts
      }
      if (ignicaoDesligou && !estaNaLoja && !estaNoCliente && saiuDaLoja && debounceOk) {
        eventos.push({ tipo: 'parada', horario: pos.dt_posicao, lat: pos.latitude, lng: pos.longitude, na_loja: false })
        ultimoEventoTs = ts
      }
      prevIgnicao = pos.ignicao
      prevNaLoja = estaNaLoja
    }

    viagens.push({
      adesao_id: adesaoId, placa, descricao, data: dia,
      saida_loja: eventos.find(e => e.tipo === 'saida_loja')?.horario || null,
      chegada_cliente: eventos.find(e => e.tipo === 'chegada_cliente')?.horario || null,
      saida_cliente: eventos.filter(e => e.tipo === 'saida_cliente').pop()?.horario || null,
      retorno_loja: eventos.filter(e => e.tipo === 'retorno_loja').pop()?.horario || null,
      eventos, posicoes_total: posDia.length,
      ultima_posicao: { dt: last.dt_posicao, lat: last.latitude, lng: last.longitude, ignicao: last.ignicao, velocidade: last.velocidade },
    })
  }

  // Ordenar por data mais recente primeiro
  return viagens.sort((a, b) => b.data.localeCompare(a.data))
}

/**
 * GET /api/pos/rastreamento
 * acao: 'veiculos' | 'posicoes' | 'viagens' | 'explorar'
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const acao = searchParams.get('acao') || 'veiculos'

    switch (acao) {
      case 'veiculos': {
        const data = await fetchRotaExata('/adesoes', { limit: '200', page: '0' })
        const veiculos = (data.data || []).map((a: any) => ({
          id: a.id, placa: a.vei_placa || '', descricao: a.vei_descricao || '',
          modelo: a.vei_modelo || '', cor: a.vei_cor || '', ano: a.vei_ano || '',
        }))
        return NextResponse.json(veiculos)
      }

      case 'posicoes': {
        const adesaoId = searchParams.get('adesao_id')
        if (!adesaoId) return NextResponse.json({ error: 'adesao_id obrigatório' }, { status: 400 })

        const limit = searchParams.get('limit') || '2000'
        const dia = searchParams.get('data') || new Date().toISOString().split('T')[0]
        const where = JSON.stringify({
          adesao_id: Number(adesaoId),
          dt_posicao: { $gte: `${dia}T00:00:00.000Z`, $lte: `${dia}T23:59:59.999Z` }
        })
        const data = await fetchRotaExata('/posicoes', { where, limit, page: '0' })
        const posicoes = Array.isArray(data.data) ? data.data : []
        return NextResponse.json(posicoes)
      }

      case 'viagens': {
        // Buscar veículos
        const veiculosData = await fetchRotaExata('/adesoes', { limit: '200', page: '0' })
        const adesoes = veiculosData.data || []

        const adesaoIdParam = searchParams.get('adesao_id')
        const diaViagens = searchParams.get('data') || new Date().toISOString().split('T')[0]
        const lista = adesaoIdParam
          ? adesoes.filter((a: any) => String(a.id) === adesaoIdParam)
          : adesoes

        const todasViagens: Viagem[] = []

        for (const adesao of lista) {
          try {
            const where = JSON.stringify({
              adesao_id: adesao.id,
              dt_posicao: { $gte: `${diaViagens}T00:00:00.000Z`, $lte: `${diaViagens}T23:59:59.999Z` }
            })
            const posData = await fetchRotaExata('/posicoes', { where, limit: '5000', page: '0' })
            const posicoes: Posicao[] = Array.isArray(posData.data) ? posData.data : []
            if (posicoes.length > 0) {
              todasViagens.push(...detectarViagens(posicoes))
            }
          } catch { /* ignora */ }
        }

        return NextResponse.json(todasViagens)
      }

      case 'explorar': {
        const token = await getToken()
        const results: Record<string, any> = {}

        // Buscar adesões
        const adesaoRes = await fetch(`${API_URL}/adesoes?limit=10&page=0`, { headers: { Authorization: token } })
        const adesaoBody = await adesaoRes.json()
        const adesoes = adesaoBody.data || []
        results['veiculos'] = adesoes.map((a: any) => ({
          id: a.id, placa: a.vei_placa, descricao: a.vei_descricao,
        }))

        // Para cada veículo, buscar últimas posições
        for (const ad of adesoes.slice(0, 5)) {
          const key = `${ad.vei_placa} (${ad.vei_descricao || ad.id})`
          try {
            const w = encodeURIComponent(JSON.stringify({ adesao_id: ad.id }))
            const r = await fetch(`${API_URL}/posicoes?where=${w}&limit=5&page=0`, { headers: { Authorization: token } })
            if (r.status === 404) {
              results[key] = { status: 404, msg: 'Sem posições' }
              continue
            }
            const body = await r.json()
            const arr = Array.isArray(body.data) ? body.data : []
            if (arr.length > 0) {
              const first = arr[0]
              const last = arr[arr.length - 1]
              results[key] = {
                total: arr.length,
                ultima_data: last.dt_posicao,
                primeira_data: first.dt_posicao,
                ignicao: last.ignicao,
                velocidade: last.velocidade,
                lat: last.latitude,
                lng: last.longitude,
                na_loja: naLoja(last.latitude, last.longitude),
              }
            } else {
              results[key] = { total: 0, msg: 'Vazio' }
            }
          } catch (e: any) {
            results[key] = { erro: e.message }
          }
        }

        return NextResponse.json(results)
      }

      default:
        return NextResponse.json({ error: `Ação desconhecida: ${acao}` }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[Rastreamento]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
