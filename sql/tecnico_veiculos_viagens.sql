-- =============================================
-- Vinculo Técnico ↔ Veículo (Rota Exata)
-- =============================================
CREATE TABLE IF NOT EXISTS tecnico_veiculos (
  id SERIAL PRIMARY KEY,
  tecnico_nome TEXT NOT NULL UNIQUE,
  adesao_id INTEGER NOT NULL,
  placa TEXT NOT NULL,
  descricao TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE tecnico_veiculos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tecnico_veiculos_all" ON tecnico_veiculos FOR ALL USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE tecnico_veiculos;

-- =============================================
-- Relatório de Viagens (GPS real vs estimado)
-- =============================================
CREATE TABLE IF NOT EXISTS tecnico_viagens (
  id SERIAL PRIMARY KEY,
  tecnico_nome TEXT NOT NULL,
  adesao_id INTEGER NOT NULL,
  placa TEXT NOT NULL,
  data DATE NOT NULL,
  id_ordem TEXT,
  cliente TEXT,
  cidade TEXT,

  -- Horários ESTIMADOS (do cronograma)
  saida_loja_estimada TEXT,
  chegada_cliente_estimada TEXT,
  retorno_loja_estimado TEXT,
  tempo_ida_estimado INTEGER, -- minutos
  tempo_volta_estimado INTEGER, -- minutos

  -- Horários REAIS (do GPS)
  saida_loja_real TIMESTAMP WITH TIME ZONE,
  chegada_cliente_real TIMESTAMP WITH TIME ZONE,
  saida_cliente_real TIMESTAMP WITH TIME ZONE,
  retorno_loja_real TIMESTAMP WITH TIME ZONE,

  -- Diferenças
  endereco_real_lat DOUBLE PRECISION,
  endereco_real_lng DOUBLE PRECISION,
  posicoes_total INTEGER DEFAULT 0,

  -- Eventos brutos do GPS
  eventos JSONB DEFAULT '[]',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE tecnico_viagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tecnico_viagens_all" ON tecnico_viagens FOR ALL USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE tecnico_viagens;

-- Índices
CREATE INDEX IF NOT EXISTS idx_tecnico_viagens_nome ON tecnico_viagens(tecnico_nome);
CREATE INDEX IF NOT EXISTS idx_tecnico_viagens_data ON tecnico_viagens(data DESC);
CREATE INDEX IF NOT EXISTS idx_tecnico_viagens_ordem ON tecnico_viagens(id_ordem);
