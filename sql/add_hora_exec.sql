-- Adiciona campos de hora início/fim de execução na Ordem_Servico
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Hora_Inicio_Exec" TEXT DEFAULT '';
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Hora_Fim_Exec" TEXT DEFAULT '';

-- Adiciona campos de hora início/fim na agenda_visao
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "hora_inicio" TEXT DEFAULT '';
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "hora_fim" TEXT DEFAULT '';
