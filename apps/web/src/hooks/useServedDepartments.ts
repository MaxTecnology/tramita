import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface AssignmentRow { department: { id: string; name: string } }

// Departamentos que atendem o cliente (ClientAssignment). Toda tarefa do cliente só pode estar num
// deles — os seletores de departamento ligados a um cliente usam esta lista, não a da organização.
export function useServedDepartments(clientId: string | undefined) {
  const { data, isLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['client-assignments', clientId],
    queryFn: () =>
      api.get<AssignmentRow[]>(`/clients/${clientId}/assignments`)
        .then((r) => r.data.map((a) => a.department).sort((a, b) => a.name.localeCompare(b.name))),
    enabled: !!clientId,
  })
  return { departments: data ?? [], isLoading }
}
