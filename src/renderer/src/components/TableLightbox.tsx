import { ResizableLightbox } from './ResizableLightbox'

type TableLightboxProps = {
  tableHtml: string
  onClose: () => void
}

export const TableLightbox = ({ tableHtml, onClose }: TableLightboxProps): React.ReactElement => (
  <ResizableLightbox open label="Expanded table" onClose={onClose}>
    <div dangerouslySetInnerHTML={{ __html: tableHtml }} />
  </ResizableLightbox>
)
