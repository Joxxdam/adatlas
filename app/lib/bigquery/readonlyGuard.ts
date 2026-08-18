export const BIGQUERY_ALLOWED_PROJECT = "first-project-394906";

export const BIGQUERY_ALLOWED_TABLES = new Set([
  "first-project-394906.DIM_MALL.BRANDS",
  "first-project-394906.DIM_MALL.CAT_BRANDS",
  "first-project-394906.DIM_PDT.CAT_NAMES",
  "first-project-394906.FACT_MALL.DAILY_SALES",
  "first-project-394906.FACT_MALL.WEEKLY_SALES",
  "first-project-394906.FACT_MALL.MONTHLY_SALES",
  "first-project-394906.FACT_RANK.WEEKLY_PRODUCT_SALES",
  "first-project-394906.FACT_RANK.MONTHLY_PRODUCT_SALES",
  "first-project-394906.FACT_REVIEWS.MONTHLY_COUNTS",
  "first-project-394906.FACT_REVIEW_RATE.WEEKLY_UPDATE",
  "first-project-394906.FACT_HOST24.PRODUCT",
  "first-project-394906.FACT_HOST24.DAILY_SALES",
  "first-project-394906.FACT_HOST24.VIEW",
  "first-project-394906.FACT_HOSTMK.PRODUCT",
  "first-project-394906.FACT_HOSTMK.DAILY_SALES",
  "first-project-394906.FACT_HOSTMK.VIEW",
  "first-project-394906.FACT_PRICE.MONTHLY_SALES",
]);

const forbiddenKeywords = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "CREATE",
  "REPLACE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CALL",
  "EXPORT",
  "LOAD",
  "COPY",
  "GRANT",
  "REVOKE",
  "EXECUTE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
] as const;

export class BigQueryReadOnlyError extends Error {
  readonly code = "read-only-violation";

  constructor(message: string) {
    super(message);
    this.name = "BigQueryReadOnlyError";
  }
}

function stripComments(sql: string) {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (quote) {
      output += current;
      if (current === "\\") {
        output += next || "";
        index += 1;
      } else if (current === quote) {
        if (sql[index + 1] === quote && quote !== "`") {
          output += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      output += current;
      continue;
    }

    if (current === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      output += " ";
      continue;
    }

    output += current;
  }

  return output;
}

function hasSqlComment(sql: string) {
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      continue;
    }
    if ((current === "-" && next === "-") || (current === "/" && next === "*") || current === "#") {
      return true;
    }
  }
  return false;
}

function maskQuotedValues(sql: string) {
  let output = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    if (quote) {
      output += " ";
      if (current === "\\") {
        output += " ";
        index += 1;
      } else if (current === quote) {
        if (sql[index + 1] === quote) {
          output += " ";
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (current === "'" || current === '"') {
      quote = current;
      output += " ";
      continue;
    }

    output += current;
  }

  return output;
}

function semicolonOutsideQuotes(sql: string) {
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") quote = current;
    else if (current === ";") return true;
  }
  return false;
}

function tableReferences(sql: string) {
  return [...sql.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((value) => value.split(".").length === 3);
}

export function assertReadOnlyBigQuery(params: {
  sql: string;
  namedParameters: Record<string, unknown>;
}) {
  if (hasSqlComment(params.sql)) {
    throw new BigQueryReadOnlyError("SQL 주석은 조회 전용 쿼리에서 허용되지 않습니다.");
  }
  const commentFree = stripComments(params.sql).trim();
  const masked = maskQuotedValues(commentFree);

  if (!/^(SELECT|WITH)\b/i.test(masked)) {
    throw new BigQueryReadOnlyError("SELECT 또는 WITH로 시작하는 조회만 허용됩니다.");
  }
  if (semicolonOutsideQuotes(commentFree)) {
    throw new BigQueryReadOnlyError("다중 SQL과 세미콜론은 허용되지 않습니다.");
  }
  if (/\bSELECT\s+(?:DISTINCT\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\.)?\*/i.test(masked)) {
    throw new BigQueryReadOnlyError("SELECT *는 허용되지 않습니다.");
  }
  for (const keyword of forbiddenKeywords) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(masked)) {
      throw new BigQueryReadOnlyError(`${keyword} 명령은 조회 전용 연결에서 허용되지 않습니다.`);
    }
  }

  const references = tableReferences(commentFree);
  if (!references.length) {
    throw new BigQueryReadOnlyError("허용 목록의 정규화된 테이블 경로가 필요합니다.");
  }
  for (const reference of references) {
    const [projectId] = reference.split(".");
    if (projectId !== BIGQUERY_ALLOWED_PROJECT || !BIGQUERY_ALLOWED_TABLES.has(reference)) {
      throw new BigQueryReadOnlyError(`허용되지 않은 BigQuery 테이블입니다: ${reference}`);
    }
  }

  const requestedParameters = new Set(
    [...masked.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1])
  );
  if (!requestedParameters.size) {
    throw new BigQueryReadOnlyError("쿼리 값은 named parameter로 전달해야 합니다.");
  }
  for (const parameterName of requestedParameters) {
    if (!Object.prototype.hasOwnProperty.call(params.namedParameters, parameterName)) {
      throw new BigQueryReadOnlyError(`named parameter가 누락되었습니다: ${parameterName}`);
    }
  }
  if (/\?/.test(masked)) {
    throw new BigQueryReadOnlyError("위치 기반 쿼리 매개변수는 허용되지 않습니다.");
  }

  return {
    references,
    parameterNames: [...requestedParameters],
  };
}
