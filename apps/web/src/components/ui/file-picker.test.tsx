import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { FilePicker } from './file-picker'

function Host() {
  const [file, setFile] = useState<File | null>(null)
  return <FilePicker label="Arquivo" file={file} onChange={setFile} />
}

it('looks like a button and shows the chosen file name', async () => {
  render(<Host />)
  expect(screen.getByText('Escolher arquivo')).toBeInTheDocument()
  expect(screen.getByText('Nenhum arquivo escolhido')).toBeInTheDocument()
  await userEvent.upload(screen.getByLabelText('Arquivo'), new File(['%PDF'], 'previa.pdf', { type: 'application/pdf' }))
  expect(screen.getByText('previa.pdf')).toBeInTheDocument()
  expect(screen.getByText('Trocar arquivo')).toBeInTheDocument()
})
