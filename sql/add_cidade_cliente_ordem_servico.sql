-- Adiciona coluna Cidade_Cliente na Ordem_Servico
ALTER TABLE "Ordem_Servico" ADD COLUMN IF NOT EXISTS "Cidade_Cliente" TEXT DEFAULT '';

-- Backfill: atualizar ordens existentes com cidade do cliente Omie (por CNPJ)
UPDATE "Ordem_Servico" os
SET "Cidade_Cliente" = c.cidade
FROM "Clientes" c
WHERE os."Cidade_Cliente" = ''
  AND os."Cnpj_Cliente" IS NOT NULL
  AND os."Cnpj_Cliente" != ''
  AND c.cidade IS NOT NULL
  AND c.cidade != ''
  AND REGEXP_REPLACE(os."Cnpj_Cliente", '[^0-9]', '', 'g') = REGEXP_REPLACE(c.cnpj_cpf, '[^0-9]', '', 'g');

-- Backfill: atualizar ordens existentes com cidade do cliente manual (por CNPJ)
UPDATE "Ordem_Servico" os
SET "Cidade_Cliente" = cm."Cli_Cidade"
FROM "Clientes_Manuais" cm
WHERE os."Cidade_Cliente" = ''
  AND os."Cnpj_Cliente" IS NOT NULL
  AND os."Cnpj_Cliente" != ''
  AND cm."Cli_Cidade" IS NOT NULL
  AND cm."Cli_Cidade" != ''
  AND REGEXP_REPLACE(os."Cnpj_Cliente", '[^0-9]', '', 'g') = REGEXP_REPLACE(cm."Cli_Cpf_Cnpj", '[^0-9]', '', 'g');

-- Backfill: tentar por nome do cliente (Omie - nome fantasia)
UPDATE "Ordem_Servico" os
SET "Cidade_Cliente" = c.cidade
FROM "Clientes" c
WHERE os."Cidade_Cliente" = ''
  AND os."Os_Cliente" IS NOT NULL
  AND os."Os_Cliente" != ''
  AND c.cidade IS NOT NULL
  AND c.cidade != ''
  AND (
    LOWER(TRIM(c.nome_fantasia)) = LOWER(TRIM(os."Os_Cliente"))
    OR LOWER(TRIM(c.razao_social)) = LOWER(TRIM(os."Os_Cliente"))
  );

-- Backfill: tentar por nome do cliente (Manual)
UPDATE "Ordem_Servico" os
SET "Cidade_Cliente" = cm."Cli_Cidade"
FROM "Clientes_Manuais" cm
WHERE os."Cidade_Cliente" = ''
  AND os."Os_Cliente" IS NOT NULL
  AND os."Os_Cliente" != ''
  AND cm."Cli_Cidade" IS NOT NULL
  AND cm."Cli_Cidade" != ''
  AND LOWER(TRIM(cm."Cli_Nome")) = LOWER(TRIM(os."Os_Cliente"));
