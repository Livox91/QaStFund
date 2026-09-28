export type ApiError = Readonly<{
  error: {
    code: string;
    message: string;
  };
}>;
