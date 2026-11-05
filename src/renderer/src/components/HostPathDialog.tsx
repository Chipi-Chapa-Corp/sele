import { createRoot } from 'react-dom/client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Folder, File, X } from 'lucide-react'
import type { HostDirectoryListing } from '../../../shared/hostDirectory'
import { Button } from './Button'
import { Input } from './Input'
import './HostPathDialog.css'

type Options = {
  initialPath: string
  file?: boolean
  browse: (path: string) => Promise<HostDirectoryListing>
  onSelect: (path: string | null) => void
}
function HostPathDialog({ initialPath, file, browse, onSelect }: Options): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const [path, setPath] = useState(initialPath)
  const [listing, setListing] = useState<HostDirectoryListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hidden, setHidden] = useState(Boolean(file))
  const [selected, setSelected] = useState<string | null>(null)
  const sequence = useRef(0)
  const open = async (value: string): Promise<void> => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await browse(value)
      if (request !== sequence.current) return
      setListing(next)
      setPath(next.path)
      setSelected(null)
    } catch (error) {
      console.warn('Unable to browse a host folder.', error)
      if (request === sequence.current)
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }
  useLayoutEffect(() => {
    dialog.current?.showModal()
  }, [])
  // The dialog owns one browse operation at mount; later operations follow explicit navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Initial path is captured for this dialog instance.
  useEffect(() => {
    void open(initialPath)
    return () => {
      sequence.current++
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="host-path-dialog"
      aria-label={file ? 'Choose identity file' : 'Choose folder'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onSelect(null)
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onSelect(null)
      }}
    >
      <header>
        <h2>{file ? 'Choose identity file' : 'Choose folder'}</h2>
        <Button
          theme="transparent"
          aria-label="Close folder picker"
          icon={<X size={18} />}
          callback={() => onSelect(null)}
        />
      </header>
      <p>Browse files on your computer.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void open(path)
        }}
      >
        <Button
          aria-label="Parent folder"
          icon={<ArrowUp size={18} />}
          disabled={!listing || listing.parent === listing.path || loading}
          callback={async () => {
            if (listing) await open(listing.parent)
          }}
        />
        <Input
          aria-label="Folder path"
          value={path}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setPath(event.currentTarget.value)}
        />
        <Button label="Go" theme="secondary" disabled={loading} callback={() => open(path)} />
      </form>
      <label className="host-path-dialog__hidden">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => setHidden(event.currentTarget.checked)}
        />{' '}
        Show hidden files
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="host-path-dialog__entries" aria-busy={loading}>
        {listing?.entries
          .filter((entry) => (hidden || !entry.name.startsWith('.')) && (file || entry.directory))
          .map((entry) => (
            <button
              type="button"
              key={entry.path}
              aria-pressed={selected === entry.path}
              onClick={() => (entry.directory ? void open(entry.path) : setSelected(entry.path))}
            >
              {entry.directory ? <Folder size={18} /> : <File size={18} />}
              <span>{entry.name}</span>
            </button>
          ))}
        {!loading && listing && !listing.entries.length && <p>This folder is empty.</p>}
        {listing?.truncated && (
          <p>Showing the first 2,000 entries. Enter a folder path to continue.</p>
        )}
      </div>
      <footer>
        <Button label="Cancel" callback={() => onSelect(null)} />
        <Button
          theme="primary"
          label={file ? 'Use file' : 'Use folder'}
          disabled={loading || Boolean(error) || (file ? !selected : !listing)}
          callback={() => onSelect(file ? selected : (listing?.path ?? null))}
        />
      </footer>
    </dialog>
  )
}
export const requestHostPath = (options: Omit<Options, 'onSelect'>): Promise<string | null> => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  return new Promise((resolve) =>
    root.render(
      <HostPathDialog
        {...options}
        onSelect={(value) => {
          root.unmount()
          container.remove()
          resolve(value)
        }}
      />
    )
  )
}
