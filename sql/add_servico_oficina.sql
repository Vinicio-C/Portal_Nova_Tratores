-- Adiciona campo Servico_Oficina na Ordem_Servico
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Servico_Oficina" BOOLEAN DEFAULT FALSE;
