'use client'

import { useAuth } from '@/hooks/useAuth'
import { usePermissoes } from '@/hooks/usePermissoes'
import SemPermissao from '@/components/SemPermissao'
import OrcamentoEditor from '@/components/orcamentos/OrcamentoEditor'

export default function OrcamentosPage() {
  const { userProfile } = useAuth()
  const { temAcesso, loading } = usePermissoes(userProfile?.id)

  if (loading) return null
  if (!temAcesso('orcamentos')) return <SemPermissao />

  return <OrcamentoEditor userName={userProfile?.nome || ''} />
}
