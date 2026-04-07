'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import FinanceiroNav from '@/components/financeiro/FinanceiroNav'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useAuth } from '@/hooks/useAuth'
import { notificarAdminsClient } from '@/hooks/useNotificarAdmins'
import {
  FileText, Calendar, User, Hash,
  CheckCircle, Upload, Paperclip, X, CreditCard
} from 'lucide-react'

export default function NovoPagarReceber() {
  const { log: auditLog } = useAuditLog()
  const { userProfile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [fornecedores, setFornecedores] = useState([])

  const [buscaFornecedor, setBuscaFornecedor] = useState('')
  const [showFornecedorList, setShowFornecedorList] = useState(false)
  const fornecedorRef = useRef(null)

  const [fileNFServ, setFileNFServ] = useState(null)
  const [fileBoleto, setFileBoleto] = useState(null)
  const [filesReq, setFilesReq] = useState([])

  const [formData, setFormData] = useState({
    entidade: '',
    valor: '',
    vencimento: '',
    motivo: '',
    numero_NF: '',
    metodo: ''
  })

  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return router.push('/login')
      const { data: fornData } = await supabase.from('Fornecedores').select('*').order('nome', { ascending: true })
      setFornecedores(fornData || [])
      setPageLoading(false)
    }
    init()
  }, [router])

  const uploadSingle = async (file, folder) => {
    if (!file) return null
    const filePath = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    await supabase.storage.from('anexos').upload(filePath, file)
    const { data } = supabase.storage.from('anexos').getPublicUrl(filePath)
    return data.publicUrl
  }

  const uploadMultiple = async (files, folder) => {
    if (!files || files.length === 0) return null
    const urls = []
    for (const file of files) {
      const url = await uploadSingle(file, folder)
      if (url) urls.push(url)
    }
    return urls.join(', ')
  }

  const salvar = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const nf = await uploadSingle(fileNFServ, 'pagar')
      const bol = await uploadSingle(fileBoleto, 'pagar')
      const reqs = await uploadMultiple(filesReq, 'pagar')

      const { error } = await supabase.from('finan_pagar').insert([{
        fornecedor: formData.entidade,
        valor: formData.valor,
        data_vencimento: formData.vencimento,
        motivo: formData.motivo,
        numero_NF: formData.numero_NF,
        metodo: formData.metodo,
        anexo_nf: nf,
        anexo_boleto: bol,
        anexo_requisicao: reqs,
        is_requisicao: true,
        status: 'financeiro'
      }])
      if (error) throw error
      auditLog({ sistema: 'financeiro', acao: 'criar', entidade: 'finan_pagar', entidade_label: `Pagar - ${formData.entidade} - R$ ${formData.valor}`, detalhes: { fornecedor: formData.entidade, valor: formData.valor, metodo: formData.metodo, nf: formData.numero_NF } })
      notificarAdminsClient('financeiro', `${userProfile?.nome || 'Usuário'} criou registro financeiro`, `Fornecedor: ${formData.entidade} — R$ ${formData.valor}`, '/financeiro')
      alert("Processo criado com sucesso.");
      router.push('/financeiro')
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  if (pageLoading) return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#6b7280', fontSize: '16px', letterSpacing: '2px', fontFamily: 'Montserrat, sans-serif' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Montserrat, sans-serif', color: '#1e293b' }}>
      <FinanceiroNav />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px' }}>
        <div style={{ width: '100%', maxWidth: '720px' }}>

          <h2 style={{ fontWeight: '500', fontSize: '24px', color: '#1e293b', marginBottom: '32px' }}>Novo Registro Financeiro</h2>

          <form onSubmit={salvar} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* FORNECEDOR */}
            <Field label="Fornecedor" icon={<User size={18} />}>
              <div ref={fornecedorRef} style={{ position:'relative' }}>
                <input
                  type="text"
                  required
                  placeholder="Pesquisar fornecedor..."
                  style={inputIconStyle}
                  value={buscaFornecedor}
                  onChange={e => { setBuscaFornecedor(e.target.value); setShowFornecedorList(true); setFormData({...formData, entidade: ''}); }}
                  onFocus={() => setShowFornecedorList(true)}
                  onBlur={e => { if (!fornecedorRef.current?.contains(e.relatedTarget)) setTimeout(() => setShowFornecedorList(false), 150); }}
                />
                {showFornecedorList && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, maxHeight:'220px', overflowY:'auto', background:'#fff', border:'1px solid #e5e7eb', borderRadius:'0 0 8px 8px', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', zIndex:10 }}>
                    {fornecedores.filter(f => f.nome.toLowerCase().includes(buscaFornecedor.toLowerCase())).map(f => (
                      <div key={f.id} tabIndex={0} onMouseDown={e => e.preventDefault()} onClick={() => { setBuscaFornecedor(f.nome); setFormData({...formData, entidade: f.nome}); setShowFornecedorList(false); }}
                        style={{ padding:'10px 14px', cursor:'pointer', fontSize:'14px', color:'#1e293b', borderBottom:'1px solid #f3f4f6', fontFamily:'Montserrat, sans-serif' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >{f.nome}</div>
                    ))}
                    {fornecedores.filter(f => f.nome.toLowerCase().includes(buscaFornecedor.toLowerCase())).length === 0 && (
                      <div style={{ padding:'12px 14px', fontSize:'13px', color:'#9ca3af', textAlign:'center' }}>Nenhum fornecedor encontrado</div>
                    )}
                  </div>
                )}
              </div>
            </Field>

            {/* METODO */}
            <Field label="Metodo de Pagamento" icon={<CreditCard size={18} />}>
              <select required style={selectStyle} onChange={e => setFormData({...formData, metodo: e.target.value})}>
                <option value="">Selecione...</option>
                <option value="Boleto">Boleto</option>
                <option value="Pix">Pix</option>
                <option value="Cartão de Crédito">Cartao de Credito</option>
                <option value="Cartão de Débito">Cartao de Debito</option>
                <option value="Dinheiro">Dinheiro</option>
                <option value="Transferência">Transferencia</option>
                <option value="Carnê ISS">Carnê ISS</option>
              </select>
            </Field>

            {/* NF — não exige para Carnê ISS */}
            {formData.metodo !== 'Carnê ISS' && (
            <Field label="Numero da Nota Fiscal" icon={<Hash size={18} />}>
              <input placeholder="000.000.000" required style={inputIconStyle} onChange={e => setFormData({...formData, numero_NF: e.target.value})} />
            </Field>
            )}

            {/* VALOR + VENCIMENTO */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field label="Valor do Registro" icon={<Hash size={18} />}>
                <input type="number" step="0.01" placeholder="0,00" required style={inputIconStyle} onChange={e => setFormData({...formData, valor: e.target.value})} />
              </Field>
              <Field label="Data de Vencimento" icon={<Calendar size={18} />}>
                <input type="date" required style={inputIconStyle} onChange={e => setFormData({...formData, vencimento: e.target.value})} />
              </Field>
            </div>

            {/* DESCRICAO */}
            <div>
              <label style={labelStyle}>Descricao ou Motivo</label>
              <textarea
                rows={3}
                placeholder="Descreva os detalhes deste lancamento..."
                required
                style={{ ...inputStyle, resize: 'none', minHeight: '80px' }}
                onChange={e => setFormData({...formData, motivo: e.target.value})}
              />
            </div>

            {/* DOCUMENTOS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
              <label style={{ ...labelStyle, marginBottom: '0' }}>Documentacao</label>

              {formData.metodo !== 'Carnê ISS' && (
                <FileUploadBtn file={fileNFServ} onSelect={setFileNFServ} label="Nota Fiscal Principal" required />
              )}

              <FileUploadBtn file={null} onSelect={null} label="Anexar Requisicoes de Compra" isMulti filesReq={filesReq} setFilesReq={setFilesReq} />

              {filesReq.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e5e7eb' }}>
                  {filesReq.map((f, i) => (
                    <div key={i} style={{ fontSize: '12px', background: '#ffffff', color: '#1e293b', padding: '6px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #e5e7eb' }}>
                      {f.name.substring(0, 20)}
                      <X size={14} style={{ cursor: 'pointer', color: '#ef4444' }} onClick={() => setFilesReq(filesReq.filter((_, idx) => idx !== i))} />
                    </div>
                  ))}
                  <button type="button" onClick={() => setFilesReq([])} style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Limpar Tudo</button>
                </div>
              )}

              <FileUploadBtn file={fileBoleto} onSelect={setFileBoleto} label="Anexar Boleto (Opcional)" />
            </div>

            <button disabled={loading} type="submit" style={{
              background: loading ? '#e5e7eb' : '#1e293b',
              color: loading ? '#6b7280' : '#ffffff',
              border: 'none',
              padding: '16px',
              borderRadius: '10px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: '0.2s',
              fontFamily: 'Montserrat, sans-serif'
            }}>
              {loading ? 'Processando...' : <><CheckCircle size={18} /> Finalizar e Criar Registro</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// --- COMPONENTES AUXILIARES ---
function Field({ label, icon, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        {icon && <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', zIndex: 1, display: 'flex' }}>{icon}</div>}
        {children}
      </div>
    </div>
  )
}

function FileUploadBtn({ file, onSelect, label, required, isMulti, filesReq, setFilesReq }) {
  if (isMulti) {
    return (
      <label style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px 16px',
        background: filesReq && filesReq.length > 0 ? '#dbeafe' : '#f8fafc',
        border: `1px ${filesReq && filesReq.length > 0 ? 'solid' : 'dashed'} ${filesReq && filesReq.length > 0 ? '#93c5fd' : '#d1d5db'}`,
        borderRadius: '10px', cursor: 'pointer', transition: '0.2s',
        fontSize: '14px', color: filesReq && filesReq.length > 0 ? '#1d4ed8' : '#6b7280'
      }}>
        {filesReq && filesReq.length > 0 ? <CheckCircle size={18} /> : <Paperclip size={18} />}
        <span style={{ flex: 1 }}>{filesReq && filesReq.length > 0 ? `${filesReq.length} Requisicoes Adicionadas` : label}</span>
        <input type="file" multiple hidden onChange={e => {
          const novos = Array.from(e.target.files);
          setFilesReq(prev => [...prev, ...novos]);
        }} />
      </label>
    )
  }

  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px 16px',
      background: file ? '#f0fdf4' : '#f8fafc',
      border: `1px ${file ? 'solid' : 'dashed'} ${file ? '#86efac' : '#d1d5db'}`,
      borderRadius: '10px', cursor: 'pointer', transition: '0.2s',
      fontSize: '14px', color: file ? '#16a34a' : '#6b7280'
    }}>
      {file ? <CheckCircle size={18} /> : <Upload size={18} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file ? file.name : label}
      </span>
      {file && (
        <span onClick={(e) => { e.preventDefault(); onSelect(null); }} style={{ color: '#ef4444', cursor: 'pointer', display: 'flex' }}>
          <X size={16} />
        </span>
      )}
      <input type="file" required={required && !file} hidden onChange={(e) => onSelect(e.target.files[0])} />
    </label>
  )
}

// --- ESTILOS ---
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' };
const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e5e7eb', outline: 'none', background: '#ffffff', color: '#1e293b', fontSize: '15px', boxSizing: 'border-box', fontFamily: 'Montserrat, sans-serif', transition: '0.2s' };
const inputIconStyle = { ...inputStyle, paddingLeft: '42px' };
const selectStyle = { ...inputIconStyle, appearance: 'none', cursor: 'pointer' };
