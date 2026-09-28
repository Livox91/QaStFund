export default function EmployeeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
