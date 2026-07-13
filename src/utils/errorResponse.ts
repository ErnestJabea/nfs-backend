import { Response } from 'express';

type ApiError = {
  status: number;
  message: string;
  code: string;
};

const toText = (error: unknown) => {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

const isDatabaseConnectionError = (error: any, text: string) => {
  return (
    error?.name === 'PrismaClientInitializationError' ||
    ['P1000', 'P1001', 'P1002', 'P1017'].includes(error?.code) ||
    /Error creating a database connection/i.test(text) ||
    /DNS resolution/i.test(text) ||
    /request timed out/i.test(text) ||
    /Can't reach database server/i.test(text) ||
    /Server selection timeout/i.test(text) ||
    /MongoServerSelectionError/i.test(text) ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(text)
  );
};

export const getApiError = (error: unknown, fallbackMessage = 'Une erreur est survenue. Veuillez reessayer.'): ApiError => {
  const anyError = error as any;
  const text = toText(error);

  if (isDatabaseConnectionError(anyError, text)) {
    return {
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Connexion a la base de donnees indisponible. Verifiez votre connexion internet, votre DNS ou la configuration DATABASE_URL.',
    };
  }

  if (
    anyError?.type === 'entity.parse.failed' ||
    (error instanceof SyntaxError && anyError?.status === 400) ||
    /JSON at position|Unexpected token/i.test(text)
  ) {
    return {
      status: 400,
      code: 'INVALID_JSON',
      message: 'Le format JSON de la requete est invalide.',
    };
  }

  if (anyError?.code === 'P2002') {
    return {
      status: 409,
      code: 'DUPLICATE_VALUE',
      message: 'Cette information est deja utilisee.',
    };
  }

  if (anyError?.code === 'P2025') {
    return {
      status: 404,
      code: 'NOT_FOUND',
      message: 'Ressource introuvable.',
    };
  }

  if (anyError?.code === 'P2023' || /Malformed ObjectID|ObjectID/i.test(text)) {
    return {
      status: 400,
      code: 'INVALID_ID',
      message: 'Identifiant invalide.',
    };
  }

  if (typeof anyError?.status === 'number' && anyError.status >= 400 && anyError.status < 500) {
    return {
      status: anyError.status,
      code: 'REQUEST_ERROR',
      message: anyError.message || fallbackMessage,
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
  };
};

export const sendErrorResponse = (res: Response, error: unknown, fallbackMessage?: string) => {
  const apiError = getApiError(error, fallbackMessage);
  return res.status(apiError.status).json({
    error: apiError.message,
    code: apiError.code,
  });
};
