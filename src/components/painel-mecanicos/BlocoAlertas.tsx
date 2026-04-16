'use client'
import { useState, useMemo, useRef } from 'react'
import {
  Plus, X, Camera, Download, ChevronDown, ChevronRight,
  MessageSquare, Check, Clock, FileText, ThumbsUp, ThumbsDown, Filter
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import jsPDF from 'jspdf'

// ─── Types ───────────────────────────────────────────────────────
export interface Alerta {
  id: number; tecnico_nome: string; tipo: string; descricao: string
  referencia_id: string | null; data_inicio: string; data_fim: string | null
  mes_referencia: string; status: string; contestacao_motivo: string | null
  contestado_por: string | null; foto_url: string | null; alvo: string
  created_at: string; updated_at: string | null
}
interface Tecnico { user_id: string; tecnico_nome: string; tecnico_email: string; mecanico_role: 'tecnico' | 'observador' }
interface OrdemServico { Id_Ordem: string; Status: string; Os_Cliente: string; Cnpj_Cliente: string; Os_Tecnico: string; Os_Tecnico2: string; Previsao_Execucao: string | null; Previsao_Faturamento: string | null; Serv_Solicitado: string; Endereco_Cliente: string; Cidade_Cliente: string; Tipo_Servico: string; Qtd_HR: string | number | null }
interface RequisicaoMecanico { id: number; tecnico_nome: string; material_solicitado: string; quantidade: string; urgencia: string; id_ordem: string | null; status: string; created_at: string }
interface Ocorrencia { id: number; tecnico_nome: string; id_ordem: string | null; tipo: string; descricao: string; pontos_descontados: number; data: string }
interface Justificativa { id: number; tecnico_nome: string; id_ordem: string | null; id_ocorrencia: number | null; justificativa: string; status: string; descontar_comissao: boolean | null; avaliado_por: string | null; data_avaliacao: string | null; created_at: string }

// ─── Helpers ─────────────────────────────────────────────────────
function getMesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function formatMes(mes: string) {
  const [y, m] = mes.split('-')
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return `${nomes[parseInt(m) - 1]} ${y}`
}
function calcDias(inicio: string, fim: string | null): number {
  const d1 = new Date(inicio + 'T00:00:00')
  const d2 = fim ? new Date(fim + 'T00:00:00') : new Date()
  return Math.max(0, Math.floor((d2.getTime() - d1.getTime()) / 86400000))
}
function formatDataHora(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return iso }
}
function formatData(iso: string): string {
  try {
    const d = new Date(iso + 'T12:00:00')
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  } catch { return iso }
}

const TIPO_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  ordem_pendente: { label: 'Ordem de Serviço', color: '#1E40AF', bg: '#DBEAFE' },
  requisicao_pendente: { label: 'Requisição', color: '#92400E', bg: '#FEF3C7' },
  infraestrutura: { label: 'Infraestrutura', color: '#0E7490', bg: '#CFFAFE' },
  manual: { label: 'Manual', color: '#7C3AED', bg: '#EDE9FE' },
}

// ─── Component ───────────────────────────────────────────────────
export default function BlocoAlertas({
  tecnicos, alertas, onRecarregar, userName, ordens, reqsMecanico, justificativas, ocorrencias,
  onAprovarRequisicao, onRecusarRequisicao, onAvaliarJustificativa, tipoOcorrencia,
}: {
  tecnicos: Tecnico[]; alertas: Alerta[]; onRecarregar: () => void; userName: string
  ordens: OrdemServico[]; reqsMecanico: RequisicaoMecanico[]; justificativas: Justificativa[]
  ocorrencias: Ocorrencia[]
  onAprovarRequisicao: (id: number) => void; onRecusarRequisicao: (id: number) => void
  onAvaliarJustificativa: (id: number, aprovada: boolean) => void
  tipoOcorrencia: Record<string, { label: string; color: string }>
}) {
  const [filtroTecnico, setFiltroTecnico] = useState('todos')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [monthToggles, setMonthToggles] = useState<Set<string>>(new Set())
  const [showNovoModal, setShowNovoModal] = useState(false)
  const [showContestarModal, setShowContestarModal] = useState<number | null>(null)
  const [contestacaoMotivo, setContestacaoMotivo] = useState('')
  const [novoAlerta, setNovoAlerta] = useState({ tecnico_nome: '', descricao: '', tipo: 'manual', alvo: 'individual' as 'individual' | 'todos' })
  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const tecAtivos = tecnicos.filter(t => t.mecanico_role === 'tecnico')
  const mesAtual = getMesAtual()
  const reqPendentes = reqsMecanico.filter(r => r.status === 'pendente')
  const justPendentes = justificativas.filter(j => j.status === 'pendente')

  // Lookup rápido de ordens
  const ordensMap = useMemo(() => {
    const m: Record<string, OrdemServico> = {}
    ordens.forEach(o => { m[o.Id_Ordem] = o })
    return m
  }, [ordens])

  // Tipos existentes nos alertas (para o filtro)
  const tiposExistentes = useMemo(() => {
    const s = new Set<string>()
    alertas.forEach(a => s.add(a.tipo))
    return Array.from(s).sort()
  }, [alertas])

  // Filtrar alertas
  const alertasFiltrados = useMemo(() => {
    let f = alertas
    if (filtroTecnico !== 'todos') f = f.filter(a => a.tecnico_nome === filtroTecnico || a.alvo === 'todos')
    if (filtroTipo !== 'todos') f = f.filter(a => a.tipo === filtroTipo)
    return f
  }, [alertas, filtroTecnico, filtroTipo])

  // Agrupar por mês (desc)
  const meses = useMemo(() => {
    const m: Record<string, Alerta[]> = {}
    // Garantir mês atual sempre aparece
    m[mesAtual] = []
    alertasFiltrados.forEach(a => {
      if (!m[a.mes_referencia]) m[a.mes_referencia] = []
      m[a.mes_referencia].push(a)
    })
    return Object.entries(m)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([mes, items]) => ({
        mes,
        items: items.sort((a, b) => b.created_at.localeCompare(a.created_at)),
        abertos: items.filter(a => a.status === 'aberto').length,
      }))
  }, [alertasFiltrados, mesAtual])

  const totalAbertosGeral = useMemo(() => alertasFiltrados.filter(a => a.status === 'aberto').length, [alertasFiltrados])
  const totalContestados = useMemo(() => alertasFiltrados.filter(a => a.status === 'contestado').length, [alertasFiltrados])

  // Mês atual aberto por padrão, outros fechados. Toggle inverte.
  const isMonthOpen = (mes: string) => {
    const toggled = monthToggles.has(mes)
    return mes === mesAtual ? !toggled : toggled
  }
  const toggleMonth = (mes: string) => setMonthToggles(prev => {
    const next = new Set(prev); if (next.has(mes)) next.delete(mes); else next.add(mes); return next
  })

  // ─── Actions ─────────────────────────────────────────────────
  const criarAlertaManual = async () => {
    if (!novoAlerta.descricao) return; setUploading(true)
    let foto_url: string | null = null
    if (fotoFile) {
      const ext = fotoFile.name.split('.').pop()
      const path = `alertas/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('anexos').upload(path, fotoFile)
      if (!error) { const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(path); foto_url = urlData.publicUrl }
    }
    const hoje = new Date().toISOString().split('T')[0]
    if (novoAlerta.alvo === 'todos') {
      await supabase.from('painel_alertas').insert(tecAtivos.map(tec => ({
        tecnico_nome: tec.tecnico_nome, tipo: novoAlerta.tipo, descricao: novoAlerta.descricao,
        referencia_id: null, data_inicio: hoje, data_fim: null, mes_referencia: mesAtual,
        status: 'aberto', foto_url, alvo: 'todos',
      })))
    } else {
      if (!novoAlerta.tecnico_nome) { setUploading(false); return }
      await supabase.from('painel_alertas').insert({
        tecnico_nome: novoAlerta.tecnico_nome, tipo: novoAlerta.tipo, descricao: novoAlerta.descricao,
        referencia_id: null, data_inicio: hoje, data_fim: null, mes_referencia: mesAtual,
        status: 'aberto', foto_url, alvo: 'individual',
      })
    }
    setNovoAlerta({ tecnico_nome: '', descricao: '', tipo: 'manual', alvo: 'individual' }); setFotoFile(null)
    setShowNovoModal(false); setUploading(false); onRecarregar()
  }

  const contestarAlerta = async (alertaId: number) => {
    if (!contestacaoMotivo.trim()) return
    await supabase.from('painel_alertas').update({
      status: 'contestado', contestacao_motivo: contestacaoMotivo, contestado_por: userName,
      updated_at: new Date().toISOString(),
    }).eq('id', alertaId)
    setContestacaoMotivo(''); setShowContestarModal(null); onRecarregar()
  }

  const fecharAlerta = async (alertaId: number) => {
    await supabase.from('painel_alertas').update({
      status: 'fechado', data_fim: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    }).eq('id', alertaId)
    onRecarregar()
  }

  const finalizarMes = async () => {
    if (!confirm(`Finalizar ${formatMes(mesAtual)}? Alertas abertos serão transferidos para o próximo mês.`)) return
    const abertos = alertas.filter(a => a.mes_referencia === mesAtual && a.status === 'aberto')
    if (abertos.length === 0) return
    const [y, m] = mesAtual.split('-').map(Number)
    const proxMes = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    const ultimoDia = new Date(y, m, 0).toISOString().split('T')[0]
    await Promise.all([
      supabase.from('painel_alertas').insert(abertos.map(a => ({
        tecnico_nome: a.tecnico_nome, tipo: a.tipo, descricao: a.descricao, referencia_id: a.referencia_id,
        data_inicio: a.data_inicio, data_fim: null, mes_referencia: proxMes, status: 'aberto',
        contestacao_motivo: null, contestado_por: null, foto_url: a.foto_url, alvo: a.alvo,
      }))),
      supabase.from('painel_alertas').update({ status: 'fechado', data_fim: ultimoDia, updated_at: new Date().toISOString() }).in('id', abertos.map(a => a.id)),
    ])
    onRecarregar()
  }

  // ─── PDF ─────────────────────────────────────────────────────
  const gerarPDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(18); doc.setFont('helvetica', 'bold')
    doc.text('Relatório de Pendências', 14, 20)
    if (filtroTecnico !== 'todos') doc.text(`Técnico: ${filtroTecnico}`, 14, 28)
    doc.setFontSize(10); doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, filtroTecnico !== 'todos' ? 36 : 28)
    let yy = filtroTecnico !== 'todos' ? 46 : 38

    meses.forEach(({ mes, items }) => {
      if (items.length === 0) return
      if (yy > 260) { doc.addPage(); yy = 20 }
      doc.setFontSize(13); doc.setFont('helvetica', 'bold')
      doc.text(formatMes(mes), 14, yy); yy += 7
      doc.setFontSize(8); doc.setFont('helvetica', 'bold')
      doc.text('Técnico', 14, yy); doc.text('Tipo', 55, yy); doc.text('Descrição', 85, yy); doc.text('Data', 150, yy); doc.text('Dias', 178, yy); doc.text('Status', 188, yy)
      yy += 2; doc.line(14, yy, 200, yy); yy += 5
      doc.setFont('helvetica', 'normal')
      items.forEach(a => {
        if (yy > 275) { doc.addPage(); yy = 20 }
        const ti = TIPO_LABELS[a.tipo] || TIPO_LABELS.manual
        const nome = a.tecnico_nome.split(' ').slice(0, 2).join(' ')
        const desc = a.descricao.length > 35 ? a.descricao.substring(0, 35) + '...' : a.descricao
        doc.text(nome.length > 18 ? nome.substring(0, 18) + '..' : nome, 14, yy)
        doc.text(ti.label, 55, yy)
        doc.text(desc, 85, yy)
        doc.text(formatData(a.data_inicio), 150, yy)
        doc.text(String(calcDias(a.data_inicio, a.data_fim)), 178, yy)
        doc.text(a.status === 'aberto' ? 'Aberto' : a.status === 'fechado' ? 'Fechado' : 'Contest.', 188, yy)
        yy += 6
      })
      yy += 8
    })
    const suffix = filtroTecnico !== 'todos' ? `_${filtroTecnico.replace(/\s/g, '_')}` : ''
    doc.save(`pendencias${suffix}.pdf`)
  }

  // ─── Estilos auxiliares ────────────────────────────────────────
  const SEL: React.CSSProperties = { padding: '7px 10px', borderRadius: 4, border: '1px solid #D0D0D0', fontSize: 13, fontWeight: 600, background: '#fff', color: '#111', cursor: 'pointer' }
  const BTN: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, borderRadius: 4, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div>
      {/* ══ JUSTIFICATIVAS PENDENTES ══ */}
      {justPendentes.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            Justificativas pendentes
            <span style={{ fontSize: 12, fontWeight: 700, background: '#FFFBEB', color: '#D97706', padding: '2px 8px', borderRadius: 4 }}>{justPendentes.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 1, border: '1px solid #D0D0D0', background: '#D0D0D0' }}>
            {justPendentes.map(j => {
              const oc = ocorrencias.find(o => o.id === j.id_ocorrencia)
              return (
                <div key={j.id} style={{ background: '#fff', padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{j.tecnico_nome}</span>
                    {j.id_ordem && <span style={{ fontSize: 12, color: '#111', fontWeight: 500 }}>OS: {j.id_ordem}</span>}
                  </div>
                  {oc && (
                    <div style={{ background: '#F7F7F7', padding: '8px 10px', borderRadius: 4, marginBottom: 8, border: '1px solid #E8E8E8' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#111', marginBottom: 3 }}>Ocorrência</div>
                      <div style={{ fontSize: 13, color: '#111' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${(tipoOcorrencia[oc.tipo] || tipoOcorrencia.outros).color}18`, color: (tipoOcorrencia[oc.tipo] || tipoOcorrencia.outros).color, marginRight: 6 }}>
                          {(tipoOcorrencia[oc.tipo] || tipoOcorrencia.outros).label}
                        </span>
                        {oc.descricao}
                        <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 6 }}>-{oc.pontos_descontados}pts</span>
                      </div>
                    </div>
                  )}
                  <div style={{ background: '#FFFBEB', padding: '8px 10px', borderRadius: 4, marginBottom: 10, border: '1px solid #FEF3C7', fontSize: 13, color: '#111', lineHeight: 1.4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 3 }}>Justificativa</div>
                    {j.justificativa}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => onAvaliarJustificativa(j.id, true)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: '#111', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      <ThumbsUp size={13} /> Aceitar
                    </button>
                    <button onClick={() => onAvaliarJustificativa(j.id, false)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: '#fff', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 4, padding: '8px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      <ThumbsDown size={13} /> Recusar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ REQUISIÇÕES PENDENTES ══ */}
      {reqPendentes.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            Requisições de material
            <span style={{ fontSize: 12, fontWeight: 700, background: '#FFFBEB', color: '#D97706', padding: '2px 8px', borderRadius: 4 }}>{reqPendentes.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 1, border: '1px solid #D0D0D0', background: '#D0D0D0' }}>
            {reqPendentes.map(req => (
              <div key={req.id} style={{ background: '#fff', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{req.tecnico_nome.split(' ').slice(0, 2).join(' ')}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: req.urgencia === 'alta' ? '#FEE2E2' : '#F0F0F0', color: req.urgencia === 'alta' ? '#DC2626' : '#111' }}>
                    {req.urgencia === 'alta' ? 'Urgente' : 'Normal'}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{req.material_solicitado}</div>
                <div style={{ fontSize: 12, color: '#111', marginTop: 3, fontWeight: 500 }}>
                  {req.quantidade && `Qtd: ${req.quantidade} · `}{req.id_ordem && `OS: ${req.id_ordem} · `}{formatDataHora(req.created_at)}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button onClick={() => onAprovarRequisicao(req.id)} style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Aprovar</button>
                  <button onClick={() => onRecusarRequisicao(req.id)} style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: '#fff', color: '#111', border: '1px solid #D0D0D0', borderRadius: 4, cursor: 'pointer' }}>Recusar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ TOOLBAR + FILTROS ══ */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>Pendências</span>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 4, background: totalAbertosGeral > 0 ? '#FEE2E2' : '#D1FAE5', color: totalAbertosGeral > 0 ? '#DC2626' : '#065F46' }}>
            {totalAbertosGeral} aberta(s)
          </span>
          {totalContestados > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 4, background: '#FEF3C7', color: '#92400E' }}>
              {totalContestados} contestada(s)
            </span>
          )}
          <span style={{ width: 1, height: 20, background: '#D0D0D0', margin: '0 4px' }} />
          <Filter size={14} color="#111" />
          <select value={filtroTecnico} onChange={e => setFiltroTecnico(e.target.value)} style={SEL}>
            <option value="todos">Todos técnicos</option>
            {tecAtivos.map(t => <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome.split(' ').slice(0, 2).join(' ')}</option>)}
          </select>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={SEL}>
            <option value="todos">Todos tipos</option>
            {tiposExistentes.map(t => <option key={t} value={t}>{(TIPO_LABELS[t] || { label: t }).label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={gerarPDF} style={{ ...BTN, background: '#fff', color: '#111', border: '1px solid #D0D0D0' }}>
            <Download size={13} /> PDF
          </button>
          <button onClick={finalizarMes} style={{ ...BTN, background: '#fff', color: '#111', border: '1px solid #D0D0D0' }}>
            <Check size={13} /> Finalizar Mês
          </button>
          <button onClick={() => setShowNovoModal(true)} style={{ ...BTN, background: '#111', color: '#fff', border: 'none' }}>
            <Plus size={13} /> Novo Alerta
          </button>
        </div>
      </div>

      {/* ══ CASCATA POR MÊS ══ */}
      <div style={{ border: '1px solid #D0D0D0' }}>
        {meses.map(({ mes, items, abertos }) => {
          const open = isMonthOpen(mes)
          const isMesAtual = mes === mesAtual

          return (
            <div key={mes} style={{ borderBottom: '1px solid #D0D0D0' }}>
              {/* Header do mês */}
              <div onClick={() => toggleMonth(mes)} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', cursor: 'pointer',
                background: isMesAtual ? '#F7F7F7' : '#FAFAFA',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {open ? <ChevronDown size={16} color="#111" /> : <ChevronRight size={16} color="#111" />}
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>{formatMes(mes)}</span>
                  {isMesAtual && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#111', color: '#fff' }}>ATUAL</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{items.length} item(ns)</span>
                  {abertos > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: '#FEE2E2', color: '#DC2626' }}>{abertos} aberta(s)</span>}
                </div>
              </div>

              {/* Lista de pendências do mês */}
              {open && items.length > 0 && (
                <div>
                  {/* Header da tabela */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '140px 130px 1fr 120px 50px 90px',
                    padding: '6px 16px', background: '#F0F0F0', borderTop: '1px solid #D0D0D0', borderBottom: '1px solid #D0D0D0',
                    fontSize: 11, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '.03em',
                  }}>
                    <span>Técnico</span>
                    <span>Tipo</span>
                    <span>Pendência</span>
                    <span>Data/Hora</span>
                    <span>Dias</span>
                    <span></span>
                  </div>

                  {items.map(a => {
                    const tipoInfo = TIPO_LABELS[a.tipo] || TIPO_LABELS.manual
                    const dias = calcDias(a.data_inicio, a.data_fim)
                    const isFechado = a.status === 'fechado'
                    const isContestado = a.status === 'contestado'
                    const ordem = a.tipo === 'ordem_pendente' && a.referencia_id ? ordensMap[a.referencia_id] : null

                    // Texto principal da pendência
                    let pendenciaTexto = a.descricao
                    let pendenciaRef = ''
                    if (a.tipo === 'ordem_pendente') {
                      pendenciaTexto = ordem ? ordem.Os_Cliente : a.descricao
                      pendenciaRef = a.referencia_id ? `#${a.referencia_id}` : ''
                    } else if (a.tipo === 'requisicao_pendente') {
                      pendenciaTexto = a.descricao
                      pendenciaRef = a.referencia_id ? `#${a.referencia_id}` : ''
                    }

                    return (
                      <div key={a.id} style={{
                        display: 'grid', gridTemplateColumns: '140px 130px 1fr 120px 50px 90px',
                        padding: '10px 16px', borderBottom: '1px solid #E8E8E8', alignItems: 'center',
                        background: isFechado ? '#FAFAFA' : '#fff',
                        opacity: isFechado ? 0.5 : 1,
                        borderLeft: `3px solid ${isFechado ? '#D0D0D0' : isContestado ? '#F59E0B' : a.status === 'aberto' ? '#EF4444' : '#D0D0D0'}`,
                      }}>
                        {/* Técnico */}
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.tecnico_nome.split(' ').slice(0, 2).join(' ')}
                        </span>

                        {/* Tipo */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: tipoInfo.bg, color: tipoInfo.color, display: 'inline-block', width: 'fit-content' }}>
                            {tipoInfo.label}
                          </span>
                          {isContestado && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: '#FEF3C7', color: '#92400E', width: 'fit-content' }}>Contestado</span>}
                          {isFechado && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: '#D1FAE5', color: '#065F46', width: 'fit-content' }}>Fechado</span>}
                        </div>

                        {/* Pendência */}
                        <div style={{ overflow: 'hidden', paddingRight: 8 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pendenciaTexto}
                            {pendenciaRef && <span style={{ fontSize: 12, fontWeight: 600, color: '#555', marginLeft: 6 }}>{pendenciaRef}</span>}
                          </div>
                          {a.tipo === 'ordem_pendente' && ordem && (
                            <div style={{ fontSize: 12, color: '#111', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descricao}</div>
                          )}
                          {a.foto_url && (
                            <img src={a.foto_url} alt="" style={{ maxWidth: 80, maxHeight: 40, borderRadius: 3, objectFit: 'cover', cursor: 'pointer', marginTop: 3 }}
                              onClick={() => window.open(a.foto_url!, '_blank')} />
                          )}
                          {isContestado && a.contestacao_motivo && (
                            <div style={{ fontSize: 11, color: '#92400E', marginTop: 2, fontWeight: 500 }}>
                              Contestação: {a.contestacao_motivo}{a.contestado_por ? ` — ${a.contestado_por}` : ''}
                            </div>
                          )}
                        </div>

                        {/* Data */}
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#111' }}>
                          {formatDataHora(a.created_at)}
                        </span>

                        {/* Dias */}
                        <span style={{ fontSize: 14, fontWeight: 900, color: isFechado ? '#CCC' : dias >= 7 ? '#DC2626' : dias >= 3 ? '#D97706' : '#111' }}>
                          {dias}d
                        </span>

                        {/* Ações */}
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {!isFechado && !isContestado && (
                            <button onClick={() => setShowContestarModal(a.id)} title="Contestar" style={{
                              background: '#FEF3C7', color: '#92400E', border: 'none', borderRadius: 3,
                              padding: '3px 7px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 3,
                            }}><MessageSquare size={10} /> Cont.</button>
                          )}
                          {!isFechado && (
                            <button onClick={() => fecharAlerta(a.id)} title="Fechar" style={{
                              background: '#D1FAE5', color: '#065F46', border: 'none', borderRadius: 3,
                              padding: '3px 7px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 3,
                            }}><Check size={10} /></button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {open && items.length === 0 && (
                <div style={{ padding: '16px', fontSize: 13, color: '#111', fontWeight: 500, textAlign: 'center', borderTop: '1px solid #E8E8E8' }}>
                  Nenhuma pendência neste mês{filtroTecnico !== 'todos' || filtroTipo !== 'todos' ? ' (com os filtros aplicados)' : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ══ MODAL NOVO ALERTA ══ */}
      {showNovoModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: '100%', maxWidth: 460, border: '1px solid #D0D0D0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#111', margin: 0 }}>Novo Alerta</h3>
              <button onClick={() => setShowNovoModal(false)} style={{ background: '#F0F0F0', border: 'none', cursor: 'pointer', width: 28, height: 28, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} color="#111" /></button>
            </div>

            {/* Destino */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#111', display: 'block', marginBottom: 5 }}>Destino</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['individual', 'todos'] as const).map(alvo => (
                  <button key={alvo} onClick={() => setNovoAlerta(p => ({ ...p, alvo }))} style={{
                    flex: 1, padding: 9, borderRadius: 4, fontSize: 13, fontWeight: 700,
                    border: `1px solid ${novoAlerta.alvo === alvo ? '#111' : '#D0D0D0'}`,
                    background: novoAlerta.alvo === alvo ? '#111' : '#fff',
                    color: novoAlerta.alvo === alvo ? '#fff' : '#111', cursor: 'pointer',
                  }}>{alvo === 'individual' ? 'Técnico específico' : 'Todos os técnicos'}</button>
                ))}
              </div>
            </div>

            {/* Técnico */}
            {novoAlerta.alvo === 'individual' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#111', display: 'block', marginBottom: 5 }}>Técnico</label>
                <select value={novoAlerta.tecnico_nome} onChange={e => setNovoAlerta(p => ({ ...p, tecnico_nome: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 4, border: '1px solid #D0D0D0', fontSize: 13, background: '#fff', color: '#111' }}>
                  <option value="">Selecione...</option>
                  {tecAtivos.map(t => <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>)}
                </select>
              </div>
            )}

            {/* Tipo */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#111', display: 'block', marginBottom: 5 }}>Tipo</label>
              <select value={novoAlerta.tipo} onChange={e => setNovoAlerta(p => ({ ...p, tipo: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 4, border: '1px solid #D0D0D0', fontSize: 13, background: '#fff', color: '#111' }}>
                {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            {/* Descrição */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#111', display: 'block', marginBottom: 5 }}>Descrição</label>
              <textarea value={novoAlerta.descricao} onChange={e => setNovoAlerta(p => ({ ...p, descricao: e.target.value }))}
                placeholder="Descreva o alerta..." rows={3}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 4, border: '1px solid #D0D0D0', fontSize: 13, resize: 'vertical', color: '#111', boxSizing: 'border-box' }} />
            </div>

            {/* Foto */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#111', display: 'block', marginBottom: 5 }}>Foto (opcional)</label>
              <input ref={fileRef} type="file" accept="image/*" onChange={e => setFotoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{
                display: 'flex', alignItems: 'center', gap: 6, background: '#fff', color: '#111',
                border: '1px dashed #D0D0D0', borderRadius: 4, padding: '9px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%', justifyContent: 'center',
              }}><Camera size={14} />{fotoFile ? fotoFile.name : 'Anexar foto'}</button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowNovoModal(false)} style={{ flex: 1, padding: 10, borderRadius: 4, fontSize: 13, fontWeight: 700, background: '#F0F0F0', color: '#111', border: 'none', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={criarAlertaManual} disabled={uploading} style={{ flex: 1, padding: 10, borderRadius: 4, fontSize: 13, fontWeight: 700, background: '#111', color: '#fff', border: 'none', cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? 'Salvando...' : 'Criar Alerta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CONTESTAR ══ */}
      {showContestarModal !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: '100%', maxWidth: 400, border: '1px solid #D0D0D0' }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 14px' }}>Contestar Alerta</h3>
            <textarea value={contestacaoMotivo} onChange={e => setContestacaoMotivo(e.target.value)}
              placeholder="Motivo da contestação..." rows={3}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 4, border: '1px solid #D0D0D0', fontSize: 13, resize: 'vertical', marginBottom: 14, color: '#111', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowContestarModal(null); setContestacaoMotivo('') }} style={{ flex: 1, padding: 10, borderRadius: 4, fontSize: 13, fontWeight: 700, background: '#F0F0F0', color: '#111', border: 'none', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => contestarAlerta(showContestarModal)} style={{ flex: 1, padding: 10, borderRadius: 4, fontSize: 13, fontWeight: 700, background: '#F59E0B', color: '#fff', border: 'none', cursor: 'pointer' }}>Contestar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
