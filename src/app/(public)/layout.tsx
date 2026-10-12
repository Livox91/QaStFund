export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="bg-canvas min-h-screen">{children}</div>;
}
