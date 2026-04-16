-- Adiciona campo de resumo na agenda_visao
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "resumo" TEXT DEFAULT '';
