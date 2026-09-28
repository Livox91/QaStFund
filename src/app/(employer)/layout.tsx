export default function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-screen bg-slate-100">{children}</div>;
}
