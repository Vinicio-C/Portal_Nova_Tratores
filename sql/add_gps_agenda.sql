-- Adiciona campos de GPS real-time na agenda_visao
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "gps_saida_oficina" TEXT DEFAULT '';
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "gps_chegada_cliente" TEXT DEFAULT '';
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "gps_saida_cliente" TEXT DEFAULT '';
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "gps_retorno_oficina" TEXT DEFAULT '';
ALTER TABLE "agenda_visao" ADD COLUMN IF NOT EXISTS "tempo_excedido" BOOLEAN DEFAULT FALSE;
