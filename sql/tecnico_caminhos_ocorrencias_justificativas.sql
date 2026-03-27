-- Tabela de caminhos/rotas dos técnicos
CREATE TABLE IF NOT EXISTS tecnico_caminhos (
  id SERIAL PRIMARY KEY,
  tecnico_nome TEXT NOT NULL,
  destino TEXT NOT NULL,
  cidade TEXT NOT NULL,
  motivo TEXT NOT NULL,
  data_saida TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'em_transito', -- em_transito, chegou, retornando
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de ocorrências (cagadas/erros)
CREATE TABLE IF NOT EXISTS tecnico_ocorrencias (
  id SERIAL PRIMARY KEY,
  tecnico_nome TEXT NOT NULL,
  id_ordem TEXT,
  tipo TEXT NOT NULL, -- atraso, erro, retrabalho, falta_material, outros
  descricao TEXT NOT NULL,
  data DATE DEFAULT CURRENT_DATE,
  pontos_descontados INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de justificativas para comissão
CREATE TABLE IF NOT EXISTS tecnico_justificativas (
  id SERIAL PRIMARY KEY,
  tecnico_nome TEXT NOT NULL,
  id_ordem TEXT,
  id_ocorrencia INTEGER REFERENCES tecnico_ocorrencias(id),
  justificativa TEXT NOT NULL,
  status TEXT DEFAULT 'pendente', -- pendente, aprovada, recusada
  descontar_comissao BOOLEAN DEFAULT NULL,
  avaliado_por TEXT,
  data_avaliacao TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS policies
ALTER TABLE tecnico_caminhos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tecnico_ocorrencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE tecnico_justificativas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso total tecnico_caminhos" ON tecnico_caminhos FOR ALL USING (true);
CREATE POLICY "Acesso total tecnico_ocorrencias" ON tecnico_ocorrencias FOR ALL USING (true);
CREATE POLICY "Acesso total tecnico_justificativas" ON tecnico_justificativas FOR ALL USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE tecnico_caminhos;
ALTER PUBLICATION supabase_realtime ADD TABLE tecnico_ocorrencias;
ALTER PUBLICATION supabase_realtime ADD TABLE tecnico_justificativas;
