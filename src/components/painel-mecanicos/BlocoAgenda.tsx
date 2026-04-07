'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, Plus, X, Search, MapPin, Trash2, FileText, Truck } from 'lucide-react'

interface Tecnico { user_id: string; tecnico_nome: string; tecnico_email: string; mecanico_role: 'tecnico' | 'observador' }
interface OrdemServico {
  Id_Ordem: string; Status: string; Os_Cliente: string; Os_Tecnico: string; Os_Tecnico2: string
  Previsao_Execucao: string | null; Tipo_Servico: string; Cidade_Cliente: string
  Endereco_Cliente: string; Cnpj_Cliente: string; Serv_Solicitado: string; Qtd_HR?: string | number | null
}
interface AgendaRow {
  id: number; data: string; tecnico_nome: string; id_ordem: string | null
  cliente: string; servico: string; endereco: string; cidade: string
  coordenadas: { lat: number; lng: number } | null
  tempo_ida_min: number; distancia_ida_km: number; qtd_horas: number
  ordem_sequencia: number; status: string; observacoes: string
}
interface ClienteOption { chave: string; display: string }

function normNome(n: string): string[] { return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2) }
function match(a: string, b: string) { if (!a || !b) return false; const pA = normNome(a), pB = normNome(b); if (!pA.length || !pB.length || pA[0] !== pB[0]) return false; if (pA.length === 1 || pB.length === 1) return true; const s = new Set(pA.slice(1)); return pB.slice(1).some(p => s.has(p)) }
function extrairSolicitacao(serv: string): string {
  if (!serv) return ''
  const idx = serv.indexOf('Solicitação do cliente:')
  if (idx === -1) return ''
  const after = serv.substring(idx + 'Solicitação do cliente:'.length)
  const fim = after.indexOf('Serviço Realizado')
  const trecho = fim > -1 ? after.substring(0, fim) : after
  return trecho.replace(/\n/g, ' ').trim()
}

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const COLORS = ['#6366F1', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6']

function getSegunda(offset: number): Date {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset * 7
  const seg = new Date(d.getFullYear(), d.getMonth(), diff)
  seg.setHours(0, 0, 0, 0)
  return seg
}

function getDiasSemana(offset: number): string[] {
  const seg = getSegunda(offset)
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(seg)
    d.setDate(seg.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

function formatDia(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

export default function BlocoAgenda({ tecnicos, ordens }: { tecnicos: Tecnico[]; ordens: OrdemServico[] }) {
  const [semanaOffset, setSemanaOffset] = useState(0)
  const [agendaSemana, setAgendaSemana] = useState<AgendaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState<Record<number, boolean>>({})
  const [obsEditando, setObsEditando] = useState<number | null>(null)

  // Add form state
  const [addKey, setAddKey] = useState<string | null>(null) // "tecNome|dia"
  const [addMode, setAddMode] = useState<'os' | 'manual'>('os')
  const [buscaOS, setBuscaOS] = useState('')
  const [addSalvando, setAddSalvando] = useState(false)

  // Manual mode state
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [clienteFilter, setClienteFilter] = useState('')
  const [clienteSelecionado, setClienteSelecionado] = useState<{ chave: string; nome: string; endereco: string; cidade: string } | null>(null)
  const [addHoras, setAddHoras] = useState(2)
  const [addObs, setAddObs] = useState('')
  const [carregandoCliente, setCarregandoCliente] = useState(false)

  const tecs = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])
  const dias = useMemo(() => getDiasSemana(semanaOffset), [semanaOffset])
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])

  // Ordens em execução (para o dropdown)
  const ordensExecucao = useMemo(() => ordens.filter(o => o.Status === 'Execução'), [ordens])

  // Ordens ativas por técnico
  const ordensPorTec = useMemo(() => {
    const m: Record<string, OrdemServico[]> = {}
    tecs.forEach(t => {
      m[t.tecnico_nome] = ordens.filter(o =>
        o.Status !== 'Concluída' && o.Status !== 'Cancelada' &&
        (match(t.tecnico_nome, o.Os_Tecnico) || match(t.tecnico_nome, o.Os_Tecnico2))
      )
    })
    return m
  }, [tecs, ordens])

  // Carregar clientes (para manual mode)
  useEffect(() => {
    fetch('/api/pos/clientes').then(r => r.ok ? r.json() : []).then(setClientes).catch(() => {})
  }, [])

  const clientesFiltrados = useMemo(() => {
    if (!clienteFilter) return []
    const terms = clienteFilter.toLowerCase().split(/\s+/).filter(Boolean)
    return clientes.filter(c => { const d = c.display.toLowerCase(); return terms.every(t => d.includes(t)) }).slice(0, 12)
  }, [clienteFilter, clientes])

  // Fetch agenda da semana inteira
  const carregarSemana = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(
        dias.map(d => fetch(`/api/pos/agenda-visao?data=${d}`).then(r => r.ok ? r.json() : []))
      )
      setAgendaSemana(results.flat())
    } catch { }
    setLoading(false)
  }, [dias])

  useEffect(() => { carregarSemana() }, [carregarSemana])

  // Salvar observação
  const salvarObs = async (id: number, obs: string) => {
    setSalvando(p => ({ ...p, [id]: true }))
    try {
      await fetch('/api/pos/agenda-visao', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, observacoes: obs }),
      })
      setAgendaSemana(p => p.map(a => a.id === id ? { ...a, observacoes: obs } : a))
    } catch { }
    setSalvando(p => ({ ...p, [id]: false }))
    setObsEditando(null)
  }

  // Remover item
  const remover = async (id: number) => {
    const r = await fetch('/api/pos/agenda-visao', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (r.ok) setAgendaSemana(p => p.filter(a => a.id !== id))
  }

  // Buscar dados do cliente quando selecionado (manual mode)
  const selecionarCliente = async (c: ClienteOption) => {
    setCarregandoCliente(true)
    setClienteFilter(c.display.split('[')[0].trim())
    try {
      const r = await fetch(`/api/pos/clientes?id=${encodeURIComponent(c.chave)}`)
      if (r.ok) {
        const data = await r.json()
        setClienteSelecionado({ chave: c.chave, nome: data.nome, endereco: data.endereco || '', cidade: data.cidade || '' })
      }
    } catch { }
    setCarregandoCliente(false)
  }

  // Encontrar última localização do técnico no dia
  const getUltimaLocalizacao = (tecNome: string, dia: string) => {
    const itemsDia = agendaSemana
      .filter(a => a.data === dia && a.tecnico_nome === tecNome && a.coordenadas)
      .sort((a, b) => a.ordem_sequencia - b.ordem_sequencia)
    return itemsDia[itemsDia.length - 1] || null
  }

  // Adicionar OS existente à agenda + abrir caminho
  const adicionarOS = async (tecNome: string, dia: string, os: OrdemServico) => {
    setAddSalvando(true)
    try {
      const horas = parseFloat(String(os.Qtd_HR || 0)) || 2
      const ultimoItem = getUltimaLocalizacao(tecNome, dia)

      // Inserir na agenda
      const r = await fetch('/api/pos/agenda-visao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: dia,
          tecnicos: [{
            nome: tecNome,
            ordens: [{
              id: os.Id_Ordem, cliente: os.Os_Cliente, cnpj: os.Cnpj_Cliente,
              endereco: os.Endereco_Cliente, cidade: os.Cidade_Cliente,
              servico: os.Serv_Solicitado, qtdHoras: horas,
              observacoes: extrairSolicitacao(os.Serv_Solicitado || ''),
            }],
          }],
        }),
      })

      if (r.ok) {
        const rows = await r.json() as AgendaRow[]
        const outrosDias = agendaSemana.filter(a => a.data !== dia)
        setAgendaSemana([...outrosDias, ...rows])

        // Abrir caminho (tecnico_caminhos)
        await fetch('/api/pos/agenda-visao/caminho', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tecnico_nome: tecNome,
            destino: os.Os_Cliente,
            cidade: os.Cidade_Cliente || '',
            motivo: os.Id_Ordem,
          }),
        }).catch(() => {})

        // Calcular rota (do último ponto ou da oficina)
        const novoItem = rows.find(row =>
          row.tecnico_nome === tecNome && row.id_ordem === os.Id_Ordem && row.tempo_ida_min === 0
        )
        if (novoItem) {
          const calcBody: Record<string, any> = { id: novoItem.id, calcular: true }
          if (ultimoItem?.coordenadas) {
            calcBody.origemLat = ultimoItem.coordenadas.lat
            calcBody.origemLng = ultimoItem.coordenadas.lng
          }
          fetch('/api/pos/agenda-visao', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(calcBody),
          }).then(async r2 => {
            if (r2.ok) {
              const updated = await r2.json()
              setAgendaSemana(p => p.map(a => a.id === updated.id ? updated : a))
            }
          })
        }
      }
    } catch { }
    fecharAdd()
    setAddSalvando(false)
  }

  // Adicionar manual (cliente do dropdown POS) + abrir caminho
  const adicionarManual = async (tecNome: string, dia: string) => {
    if (!clienteSelecionado) return
    setAddSalvando(true)
    try {
      const ultimoItem = getUltimaLocalizacao(tecNome, dia)

      const r = await fetch('/api/pos/agenda-visao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: dia,
          tecnicos: [{
            nome: tecNome,
            ordens: [{
              id: `AG-${Date.now()}`,
              cliente: clienteSelecionado.nome,
              cnpj: '',
              endereco: clienteSelecionado.endereco,
              cidade: clienteSelecionado.cidade,
              servico: '',
              qtdHoras: addHoras,
              observacoes: addObs,
            }],
          }],
        }),
      })

      if (r.ok) {
        const rows = await r.json() as AgendaRow[]
        const outrosDias = agendaSemana.filter(a => a.data !== dia)
        setAgendaSemana([...outrosDias, ...rows])

        // Abrir caminho
        await fetch('/api/pos/agenda-visao/caminho', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tecnico_nome: tecNome,
            destino: clienteSelecionado.nome,
            cidade: clienteSelecionado.cidade,
            motivo: addObs || 'Serviço agendado',
          }),
        }).catch(() => {})

        // Calcular rota
        const novoItem = rows.find(row =>
          row.tecnico_nome === tecNome && row.tempo_ida_min === 0 && row.endereco &&
          !agendaSemana.some(exist => exist.id === row.id)
        )
        if (novoItem) {
          const calcBody: Record<string, any> = { id: novoItem.id, calcular: true }
          if (ultimoItem?.coordenadas) {
            calcBody.origemLat = ultimoItem.coordenadas.lat
            calcBody.origemLng = ultimoItem.coordenadas.lng
          }
          fetch('/api/pos/agenda-visao', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(calcBody),
          }).then(async r2 => {
            if (r2.ok) {
              const updated = await r2.json()
              setAgendaSemana(p => p.map(a => a.id === updated.id ? updated : a))
            }
          })
        }
      }
    } catch { }
    fecharAdd()
    setAddSalvando(false)
  }

  const abrirAdd = (tecNome: string, dia: string) => {
    setAddKey(`${tecNome}|${dia}`)
    setAddMode('os')
    setBuscaOS('')
    setClienteFilter('')
    setClienteSelecionado(null)
    setAddHoras(2)
    setAddObs('')
  }

  const fecharAdd = () => {
    setAddKey(null)
    setBuscaOS('')
    setClienteFilter('')
    setClienteSelecionado(null)
    setAddHoras(2)
    setAddObs('')
  }

  // Label da semana
  const segStr = formatDia(dias[0])
  const sabStr = formatDia(dias[5])
  const isSemanaAtual = semanaOffset === 0

  return (
    <div>
      {/* Header com navegação */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setSemanaOffset(p => p - 1)} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #E4E4E7', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <ChevronLeft size={16} color="#71717A" />
          </button>
          <div style={{ minWidth: 180, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#18181B' }}>{segStr} — {sabStr}</div>
            <div style={{ fontSize: 12, color: '#A1A1AA' }}>
              {isSemanaAtual ? 'Semana atual' : semanaOffset > 0 ? `+${semanaOffset} semana(s)` : `${semanaOffset} semana(s)`}
            </div>
          </div>
          <button onClick={() => setSemanaOffset(p => p + 1)} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #E4E4E7', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <ChevronRight size={16} color="#71717A" />
          </button>
          {!isSemanaAtual && (
            <button onClick={() => setSemanaOffset(0)} style={{
              fontSize: 12, fontWeight: 500, color: '#6366F1', background: '#EEF2FF', border: '1px solid #C7D2FE',
              borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
            }}>
              Hoje
            </button>
          )}
        </div>
        {loading && <Loader2 size={16} color="#71717A" className="animate-spin" />}
      </div>

      {/* Grid do calendário */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{
                width: 140, padding: '10px 12px', fontSize: 12, fontWeight: 700, color: '#71717A',
                textAlign: 'left', background: '#FAFAFA', borderBottom: '2px solid #E4E4E7',
                position: 'sticky', left: 0, zIndex: 2,
              }}>
                Técnico
              </th>
              {dias.map((dia, i) => {
                const isHoje = dia === hoje
                return (
                  <th key={dia} style={{
                    padding: '10px 8px', fontSize: 12, fontWeight: 700,
                    color: isHoje ? '#6366F1' : '#71717A', textAlign: 'center',
                    background: isHoje ? '#EEF2FF' : '#FAFAFA',
                    borderBottom: isHoje ? '2px solid #6366F1' : '2px solid #E4E4E7',
                  }}>
                    <div>{DIAS_SEMANA[i]}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{formatDia(dia)}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {tecs.map((tec, tecIdx) => {
              const tecColor = COLORS[tecIdx % COLORS.length]
              const ordsAtivas = ordensPorTec[tec.tecnico_nome] || []

              return (
                <tr key={tec.user_id}>
                  {/* Nome do técnico */}
                  <td style={{
                    padding: '12px', borderBottom: '1px solid #F4F4F5', verticalAlign: 'top',
                    position: 'sticky', left: 0, background: '#fff', zIndex: 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, background: tecColor,
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, flexShrink: 0,
                      }}>
                        {tec.tecnico_nome.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#18181B', lineHeight: 1.2 }}>
                          {tec.tecnico_nome.split(' ').slice(0, 2).join(' ')}
                        </div>
                        <div style={{ fontSize: 11, color: '#A1A1AA' }}>
                          {ordsAtivas.length} ordem(s)
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Células dos dias */}
                  {dias.map(dia => {
                    const isHoje = dia === hoje
                    const cellKey = `${tec.tecnico_nome}|${dia}`
                    const isAdding = addKey === cellKey
                    const items = agendaSemana.filter(a => a.data === dia && a.tecnico_nome === tec.tecnico_nome)
                      .sort((a, b) => a.ordem_sequencia - b.ordem_sequencia)

                    // IDs já na agenda desse dia/técnico
                    const idsNaAgenda = new Set(items.map(a => a.id_ordem).filter(Boolean))

                    // Ordens do técnico disponíveis (não estão na agenda desse dia)
                    const ordsTec = ordsAtivas.filter(o => !idsNaAgenda.has(o.Id_Ordem))

                    // Filtro de busca (busca em todas as ordens em execução, não só do técnico)
                    const buscaLower = buscaOS.toLowerCase()
                    const ordsFiltradas = isAdding && addMode === 'os'
                      ? (buscaOS
                          ? ordensExecucao.filter(o =>
                              !idsNaAgenda.has(o.Id_Ordem) && (
                                o.Id_Ordem.toLowerCase().includes(buscaLower) ||
                                o.Os_Cliente.toLowerCase().includes(buscaLower) ||
                                (o.Cidade_Cliente || '').toLowerCase().includes(buscaLower) ||
                                (o.Tipo_Servico || '').toLowerCase().includes(buscaLower)
                              )
                            )
                          : ordsTec
                        )
                      : []

                    return (
                      <td key={dia} style={{
                        padding: '6px', borderBottom: '1px solid #F4F4F5', verticalAlign: 'top',
                        background: isHoje ? '#FAFAFF' : '#fff',
                        borderLeft: '1px solid #F4F4F5',
                        position: 'relative',
                      }}>
                        {items.length === 0 && !isAdding ? (
                          <div
                            onClick={() => abrirAdd(tec.tecnico_nome, dia)}
                            style={{
                              textAlign: 'center', padding: '12px 0', color: '#E4E4E7', fontSize: 11,
                              cursor: 'pointer', borderRadius: 6, transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#F4F4F5'; e.currentTarget.style.color = '#A1A1AA' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#E4E4E7' }}
                          >
                            <Plus size={14} style={{ display: 'inline' }} />
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {items.map(row => (
                              <div key={row.id} style={{
                                padding: '8px 10px', borderRadius: 8,
                                background: '#F9FAFB', border: '1px solid #F4F4F5',
                                borderLeft: `3px solid ${tecColor}`,
                              }}>
                                {/* OS + horas + delete */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                                  <span style={{
                                    fontSize: 11, fontWeight: 700, color: '#fff', background: tecColor,
                                    padding: '1px 6px', borderRadius: 4,
                                  }}>
                                    {row.id_ordem?.startsWith('AG-') ? 'Manual' : (row.id_ordem || 'Manual')}
                                  </span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ fontSize: 10, color: '#A1A1AA', fontWeight: 600 }}>{row.qtd_horas}h</span>
                                    <button onClick={() => remover(row.id)} style={{
                                      background: 'none', border: 'none', cursor: 'pointer', color: '#D4D4D8', padding: 1,
                                      transition: 'color 0.15s',
                                    }}
                                      onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                                      onMouseLeave={e => (e.currentTarget.style.color = '#D4D4D8')}
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  </div>
                                </div>

                                {/* Cliente */}
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', lineHeight: 1.3 }}>
                                  {row.cliente ? row.cliente.split(' ').slice(0, 3).join(' ') : '—'}
                                </div>

                                {/* Cidade */}
                                {row.cidade && (
                                  <div style={{ fontSize: 10, color: '#A1A1AA', marginTop: 1 }}>{row.cidade}</div>
                                )}

                                {/* Rota */}
                                {row.tempo_ida_min > 0 && (
                                  <div style={{ fontSize: 10, color: '#71717A', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <Truck size={9} />
                                    {Math.round(row.tempo_ida_min)}min · {row.distancia_ida_km}km
                                  </div>
                                )}

                                {/* Observação */}
                                {obsEditando === row.id ? (
                                  <div style={{ marginTop: 4 }}>
                                    <textarea
                                      autoFocus
                                      defaultValue={row.observacoes || ''}
                                      onBlur={e => salvarObs(row.id, e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); salvarObs(row.id, (e.target as HTMLTextAreaElement).value) } }}
                                      style={{
                                        width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4,
                                        border: '1px solid #C7D2FE', background: '#EEF2FF', outline: 'none',
                                        resize: 'vertical', minHeight: 32, boxSizing: 'border-box', color: '#18181B',
                                      }}
                                      placeholder="Observação..."
                                    />
                                    {salvando[row.id] && <Loader2 size={10} className="animate-spin" style={{ marginTop: 2 }} />}
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => setObsEditando(row.id)}
                                    style={{
                                      marginTop: 4, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 3,
                                      color: row.observacoes ? '#4F46E5' : '#D4D4D8',
                                      background: row.observacoes ? '#EEF2FF' : 'transparent',
                                      padding: row.observacoes ? '3px 6px' : '2px 0', borderRadius: 4,
                                    }}
                                  >
                                    <MessageSquare size={10} style={{ marginTop: 1, flexShrink: 0 }} />
                                    <span style={{ lineHeight: 1.3 }}>
                                      {row.observacoes || 'Obs...'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}

                            {/* Botão + abaixo dos items */}
                            {!isAdding && (
                              <div
                                onClick={() => abrirAdd(tec.tecnico_nome, dia)}
                                style={{
                                  textAlign: 'center', padding: '4px 0', color: '#D4D4D8', fontSize: 10,
                                  cursor: 'pointer', borderRadius: 4, transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#F4F4F5'; e.currentTarget.style.color = '#71717A' }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#D4D4D8' }}
                              >
                                <Plus size={12} style={{ display: 'inline' }} />
                              </div>
                            )}
                          </div>
                        )}

                        {/* ══ Popup de adicionar ══ */}
                        {isAdding && (
                          <div style={{
                            position: 'absolute', top: 0, left: -10, zIndex: 100, width: 360,
                            background: '#fff', borderRadius: 14, border: '1px solid #E4E4E7',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)',
                          }}>
                            {/* Header */}
                            <div style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '14px 16px', borderBottom: `2px solid ${tecColor}`,
                            }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#18181B' }}>
                                Novo caminho — {tec.tecnico_nome.split(' ')[0]} · {formatDia(dia)}
                              </div>
                              <button onClick={fecharAdd} style={{
                                background: '#F4F4F5', border: 'none', borderRadius: 6, cursor: 'pointer',
                                width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                <X size={12} color="#71717A" />
                              </button>
                            </div>

                            {/* Tabs: Ordens de Serviço | Cliente (manual) */}
                            <div style={{ display: 'flex', borderBottom: '1px solid #E4E4E7' }}>
                              <button onClick={() => setAddMode('os')} style={{
                                flex: 1, padding: '10px 0', fontSize: 12, fontWeight: addMode === 'os' ? 700 : 400,
                                border: 'none', cursor: 'pointer', background: 'transparent',
                                color: addMode === 'os' ? '#18181B' : '#A1A1AA',
                                borderBottom: addMode === 'os' ? `2px solid ${tecColor}` : '2px solid transparent',
                                marginBottom: -1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                              }}>
                                <FileText size={12} /> Ordens
                                {ordsTec.length > 0 && (
                                  <span style={{ fontSize: 10, fontWeight: 600, background: tecColor, color: '#fff', padding: '1px 6px', borderRadius: 8 }}>
                                    {ordsTec.length}
                                  </span>
                                )}
                              </button>
                              <button onClick={() => setAddMode('manual')} style={{
                                flex: 1, padding: '10px 0', fontSize: 12, fontWeight: addMode === 'manual' ? 700 : 400,
                                border: 'none', cursor: 'pointer', background: 'transparent',
                                color: addMode === 'manual' ? '#18181B' : '#A1A1AA',
                                borderBottom: addMode === 'manual' ? `2px solid ${tecColor}` : '2px solid transparent',
                                marginBottom: -1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                              }}>
                                <Plus size={12} /> Cliente (manual)
                              </button>
                            </div>

                            {/* ── Tab: Ordens de Serviço ── */}
                            {addMode === 'os' && (
                              <div style={{ padding: '12px 14px' }}>
                                {/* Busca */}
                                <div style={{ position: 'relative', marginBottom: 10 }}>
                                  <Search size={13} color="#A1A1AA" style={{ position: 'absolute', left: 10, top: 9 }} />
                                  <input
                                    value={buscaOS}
                                    onChange={e => setBuscaOS(e.target.value)}
                                    placeholder="Buscar OS, cliente, cidade..."
                                    style={{
                                      fontSize: 12, padding: '8px 10px 8px 30px', border: '1px solid #E4E4E7', borderRadius: 8,
                                      outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#18181B',
                                    }}
                                  />
                                </div>

                                {/* Lista de OS */}
                                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                                  {ordsFiltradas.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#D4D4D8', fontSize: 12 }}>
                                      {buscaOS ? 'Nenhuma OS encontrada' : 'Todas as ordens já estão na agenda'}
                                    </div>
                                  ) : (
                                    ordsFiltradas.map(os => {
                                      const horas = parseFloat(String(os.Qtd_HR || 0)) || 2
                                      const isTecPrimario = match(tec.tecnico_nome, os.Os_Tecnico)
                                      return (
                                        <div key={os.Id_Ordem} style={{
                                          padding: '10px 12px', marginBottom: 6, borderRadius: 10,
                                          border: '1px solid #F0F0F2', background: '#fff', cursor: 'pointer',
                                          transition: 'all 0.15s',
                                        }}
                                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#D4D4D8'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)' }}
                                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#F0F0F2'; e.currentTarget.style.boxShadow = 'none' }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                              <span style={{ fontSize: 11, fontWeight: 700, color: '#18181B' }}>{os.Id_Ordem}</span>
                                              {os.Tipo_Servico && (
                                                <span style={{ fontSize: 9, fontWeight: 500, color: '#71717A', background: '#F4F4F5', padding: '1px 5px', borderRadius: 4 }}>
                                                  {os.Tipo_Servico}
                                                </span>
                                              )}
                                              {!isTecPrimario && (
                                                <span style={{ fontSize: 9, fontWeight: 500, color: '#A1A1AA', background: '#FAFAFA', padding: '1px 4px', borderRadius: 3 }}>
                                                  2o téc.
                                                </span>
                                              )}
                                            </div>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); adicionarOS(tec.tecnico_nome, dia, os) }}
                                              disabled={addSalvando}
                                              style={{
                                                display: 'flex', alignItems: 'center', gap: 4,
                                                background: tecColor, color: '#fff', border: 'none', borderRadius: 6,
                                                padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                                boxShadow: `0 1px 4px ${tecColor}30`,
                                              }}
                                            >
                                              {addSalvando ? <Loader2 size={9} className="animate-spin" /> : <Plus size={9} />} Adicionar
                                            </button>
                                          </div>
                                          <div style={{ fontSize: 12, fontWeight: 500, color: '#3F3F46', marginBottom: 2 }}>
                                            {os.Os_Cliente}
                                          </div>
                                          <div style={{ fontSize: 10, color: '#A1A1AA', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {os.Cidade_Cliente && <span>{os.Cidade_Cliente}</span>}
                                            {os.Cidade_Cliente && <span style={{ color: '#E4E4E7' }}>·</span>}
                                            <span>{horas}h</span>
                                            {os.Endereco_Cliente && (
                                              <>
                                                <span style={{ color: '#E4E4E7' }}>·</span>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><MapPin size={8} /> {os.Endereco_Cliente.substring(0, 30)}</span>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })
                                  )}
                                </div>

                                {/* Fechar */}
                                <div style={{ textAlign: 'center', marginTop: 8 }}>
                                  <button onClick={fecharAdd} style={{
                                    background: '#fff', border: '1px solid #E4E4E7', borderRadius: 8, cursor: 'pointer',
                                    color: '#71717A', fontSize: 11, fontWeight: 500, padding: '5px 14px',
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                  }}>
                                    <X size={10} /> Fechar
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* ── Tab: Cliente manual ── */}
                            {addMode === 'manual' && (
                              <div style={{ padding: '14px 16px' }}>
                                {/* Cliente search */}
                                <div style={{ marginBottom: 10, position: 'relative' }}>
                                  <label style={{ fontSize: 11, fontWeight: 600, color: '#71717A', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    Cliente
                                  </label>
                                  <div style={{ position: 'relative' }}>
                                    <Search size={13} color="#A1A1AA" style={{ position: 'absolute', left: 10, top: 10 }} />
                                    <input
                                      value={clienteFilter}
                                      onChange={e => { setClienteFilter(e.target.value); setClienteSelecionado(null) }}
                                      placeholder="Buscar cliente..."
                                      style={{
                                        fontSize: 12, padding: '8px 12px 8px 32px', border: '1px solid #E4E4E7', borderRadius: 8,
                                        outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#18181B',
                                      }}
                                    />
                                  </div>
                                  {/* Dropdown */}
                                  {clienteFilter && !clienteSelecionado && clientesFiltrados.length > 0 && (
                                    <div style={{
                                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 110,
                                      background: '#fff', border: '1px solid #E4E4E7', borderRadius: 10,
                                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 180, overflowY: 'auto', marginTop: 4,
                                    }}>
                                      {clientesFiltrados.map(c => (
                                        <div key={c.chave}
                                          onClick={() => selecionarCliente(c)}
                                          style={{
                                            padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #F4F4F5',
                                            transition: 'background 0.1s',
                                          }}
                                          onMouseEnter={e => (e.currentTarget.style.background = '#F4F4F5')}
                                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                          <div style={{ fontWeight: 600, color: '#18181B' }}>{c.display.split('[')[0].trim()}</div>
                                          {c.display.includes('[') && (
                                            <div style={{ fontSize: 10, color: '#A1A1AA' }}>{c.display.substring(c.display.indexOf('['))}</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {carregandoCliente && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#71717A', fontSize: 11, marginBottom: 10 }}>
                                    <Loader2 size={12} className="animate-spin" /> Carregando...
                                  </div>
                                )}

                                {/* Endereço (auto-preenchido) */}
                                {clienteSelecionado && (
                                  <div style={{ marginBottom: 10, padding: '10px 12px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: '#16A34A', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <MapPin size={10} /> Endereço vinculado
                                    </div>
                                    <div style={{ fontSize: 12, color: '#18181B', fontWeight: 500 }}>
                                      {clienteSelecionado.endereco || 'Sem endereço cadastrado'}
                                    </div>
                                    {clienteSelecionado.cidade && (
                                      <div style={{ fontSize: 11, color: '#71717A', marginTop: 1 }}>{clienteSelecionado.cidade}</div>
                                    )}
                                  </div>
                                )}

                                {/* Horas + Obs */}
                                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 10 }}>
                                  <div>
                                    <label style={{ fontSize: 11, fontWeight: 600, color: '#71717A', marginBottom: 4, display: 'block', textTransform: 'uppercase' }}>Horas</label>
                                    <input type="number" step="0.5" min="0.5" value={addHoras}
                                      onChange={e => setAddHoras(parseFloat(e.target.value) || 1)}
                                      style={{
                                        fontSize: 12, padding: '8px 10px', border: '1px solid #E4E4E7', borderRadius: 8,
                                        outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#18181B',
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ fontSize: 11, fontWeight: 600, color: '#71717A', marginBottom: 4, display: 'block', textTransform: 'uppercase' }}>Observação</label>
                                    <input value={addObs} onChange={e => setAddObs(e.target.value)}
                                      placeholder="Ex: Levar peças..."
                                      style={{
                                        fontSize: 12, padding: '8px 10px', border: '1px solid #E4E4E7', borderRadius: 8,
                                        outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#18181B',
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Info de rota */}
                                {clienteSelecionado && items.length > 0 && items[items.length - 1].coordenadas && (
                                  <div style={{ marginBottom: 10, fontSize: 10, color: '#71717A', background: '#F4F4F5', padding: '5px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Truck size={10} /> Rota a partir de: <strong>{items[items.length - 1].cliente?.split(' ').slice(0, 2).join(' ')}</strong>
                                  </div>
                                )}

                                {/* Botões */}
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button onClick={() => adicionarManual(tec.tecnico_nome, dia)}
                                    disabled={!clienteSelecionado || addSalvando}
                                    style={{
                                      flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer',
                                      background: clienteSelecionado ? tecColor : '#E4E4E7',
                                      color: clienteSelecionado ? '#fff' : '#A1A1AA',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                      boxShadow: clienteSelecionado ? `0 2px 6px ${tecColor}30` : 'none',
                                    }}>
                                    {addSalvando ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                                    Adicionar
                                  </button>
                                  <button onClick={fecharAdd} style={{
                                    padding: '9px 14px', borderRadius: 8, border: '1px solid #E4E4E7', background: '#fff',
                                    cursor: 'pointer', color: '#71717A', fontSize: 12, fontWeight: 500,
                                  }}>
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
