CREATE TABLE portal_lembretes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criador_id UUID NOT NULL REFERENCES auth.users(id),
  criador_nome TEXT NOT NULL,
  destinatario_id UUID NOT NULL REFERENCES auth.users(id),
  destinatario_nome TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  data_hora TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente, concluido, visto
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE portal_lembretes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read own lembretes"
  ON portal_lembretes FOR SELECT TO authenticated
  USING (criador_id = auth.uid() OR destinatario_id = auth.uid());

CREATE POLICY "Authenticated users can insert lembretes"
  ON portal_lembretes FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update own lembretes"
  ON portal_lembretes FOR UPDATE TO authenticated
  USING (criador_id = auth.uid() OR destinatario_id = auth.uid());

CREATE INDEX idx_lembretes_destinatario ON portal_lembretes(destinatario_id, status, data_hora);
