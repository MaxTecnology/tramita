// Departamento selecionado no formulário de nova solicitação, dado o que o usuário pode escolher na
// empresa atual: escolha que não existe mais (trocou de empresa) é descartada; com um só, já vem marcado.
export function resolveDepartmentSelection(current: string, departments: { id: string }[]): string {
  if (departments.length === 1) return departments[0].id
  return departments.some((d) => d.id === current) ? current : ''
}
