import { X } from 'lucide-react'
import { Fragment, useId, useRef, useState } from 'react'
import type {
  ProviderMcpToolApproval,
  ProviderPendingUserInput,
  ProviderUserInputResponse
} from '../../../shared/provider'
import { getElicitationDefaults, record } from '../../../shared/elicitation'
import { appApi } from '../appApi'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { CompactMarkdown } from './CompactMarkdown'
import { Input } from './Input'

type Props = {
  request: ProviderPendingUserInput
  disabled?: boolean
  error?: string | null
  onRespond: (response: ProviderUserInputResponse) => Promise<void> | void
}

const enumOptions = (field: Record<string, unknown>): { value: string; title: string }[] | null => {
  if (Array.isArray(field.enum) && field.enum.every((value) => typeof value === 'string'))
    return field.enum.map((value, index) => ({
      value,
      title:
        Array.isArray(field.enumNames) && typeof field.enumNames[index] === 'string'
          ? field.enumNames[index]
          : value
    }))
  const choices = field.oneOf ?? field.anyOf
  if (Array.isArray(choices) && choices.every((value) => typeof record(value)?.const === 'string'))
    return choices.map((value) => ({
      value: value.const,
      title: typeof value.title === 'string' ? value.title : value.const
    }))
  return null
}

function ToolApprovalPreview({ approval }: { approval: ProviderMcpToolApproval }) {
  const parameters = new Map(approval.parameters.map((parameter) => [parameter.name, parameter]))
  const take = (...names: string[]) => {
    for (const name of names) {
      const parameter = parameters.get(name)
      if (typeof parameter?.value !== 'string') continue
      parameters.delete(name)
      return parameter.value
    }
    return undefined
  }
  const isPullRequest = approval.toolName === 'github.create_pull_request'
  const title = isPullRequest ? take('title') : undefined
  const repository = isPullRequest ? take('repository_full_name') : undefined
  const head = isPullRequest ? take('head', 'head_branch') : undefined
  const base = isPullRequest ? take('base', 'base_branch') : undefined
  const body = isPullRequest ? take('body') : undefined
  const draft = parameters.get('draft')?.value
  if (isPullRequest && typeof draft === 'boolean') parameters.delete('draft')

  return (
    <div className="chat-elicitation__preview">
      {title && <strong className="chat-elicitation__preview-title">{title}</strong>}
      {(repository || head || base || (isPullRequest && draft === true)) && (
        <div className="chat-elicitation__preview-context">
          {repository && <span>{repository}</span>}
          {(head || base) && (
            <span>
              {head && <code>{head}</code>}
              {base && (
                <>
                  {head ? ' into ' : 'Into '}
                  <code>{base}</code>
                </>
              )}
              {head && !base && ' (source branch)'}
            </span>
          )}
          {isPullRequest && draft === true && <span>Draft</span>}
        </div>
      )}
      {body && (
        <div className="chat-elicitation__preview-body" tabIndex={0}>
          <CompactMarkdown content={body} staticPreview />
        </div>
      )}
      {parameters.size > 0 && (
        <dl className="chat-elicitation__parameters" tabIndex={0}>
          {Array.from(parameters.values(), ({ name, label, value }) => (
            <Fragment key={name}>
              <dt>{label}</dt>
              <dd>
                <ToolApprovalValue value={value} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}

const isoDatePattern =
  /^(\d{4}-\d{2}-\d{2})(?:T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/i

function formatApprovalDate(value: string): string | null {
  const match = isoDatePattern.exec(value)
  if (!match) return null
  const [, day, clock, zone] = match
  const calendarDay = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== day)
    return null

  const date = clock ? new Date(`${day}T${clock}${zone || 'Z'}`) : calendarDay
  if (!Number.isFinite(date.getTime())) return null

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(clock && { hour: 'numeric', minute: '2-digit' }),
    ...(clock && Number(clock.slice(6)) > 0 && { second: '2-digit' }),
    ...(zone ? { timeZoneName: 'short' } : { timeZone: 'UTC' })
  }).format(date)
}

function ToolApprovalValue({ value }: { value: unknown }): React.ReactNode {
  if (typeof value === 'string') {
    const formatted = formatApprovalDate(value)
    return formatted ? (
      <time dateTime={value} title={value}>
        {formatted}
      </time>
    ) : (
      value || 'Empty'
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Empty'
    return (
      <ul className="chat-elicitation__parameter-array">
        {value.map((item, index) => (
          <li key={index}>
            <ToolApprovalValue value={item} />
          </li>
        ))}
      </ul>
    )
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value && typeof value === 'object') return <pre>{JSON.stringify(value, null, 2)}</pre>
  return value == null ? 'Empty' : String(value)
}

export const ElicitationRequestBox = ({
  request,
  disabled = false,
  error,
  onRespond
}: Props): React.ReactElement => {
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const interaction = request.elicitation!
  const schema = interaction.mode === 'form' ? interaction.schema : {}
  const approval = interaction.mode === 'form' ? interaction.toolApproval : undefined
  const [answers, setAnswers] = useState(() => getElicitationDefaults(schema))
  const [json, setJson] = useState(() => JSON.stringify(getElicitationDefaults(schema), null, 2))
  const [localError, setLocalError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const serverName = interaction.serverName === 'codex_apps' ? 'Codex Apps' : interaction.serverName
  const serviceName = approval ? approval.connectorName : serverName
  const showServiceName =
    serviceName &&
    (!approval || !request.question.toLowerCase().includes(serviceName.toLowerCase()))
  const fields = record(schema.properties)
  const flat =
    schema.type === 'object' &&
    !!fields &&
    Object.values(fields).every((value) => {
      const field = record(value)
      return (
        field &&
        (['string', 'number', 'integer', 'boolean'].includes(String(field.type)) ||
          (field.type === 'array' && enumOptions(record(field.items) ?? {})))
      )
    })
  const setValue = (key: string, value: unknown): void =>
    setAnswers((previous) => {
      const next = { ...previous }
      if (value === undefined) delete next[key]
      else
        Object.defineProperty(next, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true
        })
      return next
    })
  const submit = (): void => {
    if (disabled || !formRef.current?.reportValidity()) return
    let content = answers
    if (!flat) {
      try {
        const parsed = record(JSON.parse(json))
        if (!parsed) throw new Error()
        content = parsed
      } catch {
        setLocalError('Enter a JSON object containing the form answers.')
        return
      }
    }
    setLocalError(null)
    void onRespond({ kind: 'elicitation', action: 'accept', content })
  }
  const open = async (): Promise<void> => {
    if (interaction.mode !== 'url' || disabled) return
    try {
      const result = await appApi.handleExternalLink({ url: interaction.url, action: 'open' })
      if (result?.action === 'open') setOpened(true)
    } catch {
      setLocalError('Unable to open the link. Please retry.')
    }
  }
  return (
    <section className="chat-approval chat-user-input chat-elicitation" aria-labelledby={id}>
      <span className="chat-user-input__dismiss">
        <Button
          aria-label="Cancel request"
          callback={() => onRespond({ kind: 'cancel' })}
          disabled={disabled && interaction.mode !== 'verification'}
          icon={<X aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="Cancel"
        />
      </span>
      <div className="chat-approval__main">
        {showServiceName && <span className="chat-elicitation__label">{serviceName}</span>}
        <div id={id} className="chat-approval__summary chat-elicitation__message">
          <CompactMarkdown content={request.question} />
        </div>
      </div>
      {approval && approval.parameters.length > 0 && <ToolApprovalPreview approval={approval} />}
      <div className="chat-elicitation__content">
        {interaction.mode === 'form' && (
          <form
            ref={formRef}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <fieldset disabled={disabled} className="chat-elicitation__fields">
              {flat ? (
                Object.entries(fields!).map(([key, raw]) => {
                  const field = record(raw)!
                  const required = Array.isArray(schema.required) && schema.required.includes(key)
                  const label = `${typeof field.title === 'string' ? field.title : key}${required ? ' *' : ''}`
                  const fieldId = `${id}-${key}`
                  const choices = enumOptions(
                    field.type === 'array' ? (record(field.items) ?? {}) : field
                  )
                  return (
                    <div className="chat-elicitation__field" key={key}>
                      <label htmlFor={fieldId}>{label}</label>
                      {typeof field.description === 'string' && (
                        <span
                          className="chat-user-input__choice-description"
                          id={`${fieldId}-description`}
                        >
                          {field.description}
                        </span>
                      )}
                      {field.type === 'boolean' ? (
                        <Checkbox
                          id={fieldId}
                          aria-describedby={
                            field.description ? `${fieldId}-description` : undefined
                          }
                          checked={answers[key] === true}
                          onChange={(event) => setValue(key, event.target.checked)}
                        />
                      ) : choices && field.type === 'array' ? (
                        <div role="group" aria-label={label} className="chat-elicitation__checks">
                          {choices.map((choice) => (
                            <Checkbox
                              key={choice.value}
                              label={choice.title}
                              checked={
                                Array.isArray(answers[key]) && answers[key].includes(choice.value)
                              }
                              onChange={(event) => {
                                const current = Array.isArray(answers[key]) ? answers[key] : []
                                setValue(
                                  key,
                                  event.target.checked
                                    ? [...current, choice.value]
                                    : current.filter((value) => value !== choice.value)
                                )
                              }}
                            />
                          ))}
                        </div>
                      ) : choices ? (
                        <select
                          required={required}
                          id={fieldId}
                          className="ui-input"
                          value={
                            answers[key] === undefined
                              ? ''
                              : String(choices.findIndex((choice) => choice.value === answers[key]))
                          }
                          onChange={(event) =>
                            setValue(
                              key,
                              event.target.value === ''
                                ? undefined
                                : choices[Number(event.target.value)].value
                            )
                          }
                        >
                          <option value="">Choose…</option>
                          {choices.map((choice, index) => (
                            <option key={choice.value} value={String(index)}>
                              {choice.title}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={fieldId}
                          aria-describedby={
                            field.description ? `${fieldId}-description` : undefined
                          }
                          type={
                            field.type === 'number' || field.type === 'integer'
                              ? 'number'
                              : field.format === 'email'
                                ? 'email'
                                : field.format === 'date'
                                  ? 'date'
                                  : field.writeOnly === true || field.format === 'password'
                                    ? 'password'
                                    : 'text'
                          }
                          required={required}
                          min={typeof field.minimum === 'number' ? field.minimum : undefined}
                          max={typeof field.maximum === 'number' ? field.maximum : undefined}
                          minLength={
                            typeof field.minLength === 'number' ? field.minLength : undefined
                          }
                          maxLength={
                            typeof field.maxLength === 'number' ? field.maxLength : undefined
                          }
                          step={field.type === 'integer' ? 1 : 'any'}
                          value={
                            typeof answers[key] === 'string' || typeof answers[key] === 'number'
                              ? answers[key]
                              : ''
                          }
                          onChange={(event) =>
                            setValue(
                              key,
                              event.target.value === ''
                                ? undefined
                                : field.type === 'number' || field.type === 'integer'
                                  ? Number(event.target.value)
                                  : event.target.value
                            )
                          }
                        />
                      )}
                    </div>
                  )
                })
              ) : (
                <label className="chat-elicitation__field">
                  Form answers (JSON)
                  <span className="chat-user-input__choice-description">
                    This service uses a custom form. Enter its answers as JSON; they will be checked
                    against the service’s schema.
                  </span>
                  <details>
                    <summary>Requested schema</summary>
                    <pre>{JSON.stringify(schema, null, 2)}</pre>
                  </details>
                  <textarea
                    className="ui-input chat-elicitation__json"
                    aria-label="Form answers (JSON)"
                    value={json}
                    onChange={(event) => setJson(event.target.value)}
                  />
                </label>
              )}
            </fieldset>
          </form>
        )}
        {interaction.mode === 'url' && (
          <>
            <span className="chat-elicitation__url">{interaction.url}</span>
            <span className="chat-user-input__choice-description">
              Complete the interaction at this address, then return here to continue.
            </span>
          </>
        )}
        {interaction.mode === 'verification' && (
          <>
            <strong>{interaction.title}</strong>
            <p>
              {interaction.availability === 'checking'
                ? 'Checking device verification availability…'
                : interaction.availability === 'available'
                  ? 'Verify this request using your device. Your system may ask for biometric confirmation.'
                  : interaction.reason}
            </p>
          </>
        )}
        {interaction.mode === 'unsupported' && <p>{interaction.reason}</p>}
        {(localError || error) && (
          <span className="chat-approval__error" role="alert">
            {localError || error}
          </span>
        )}
      </div>
      <div className="chat-elicitation__footer">
        <div className="chat-approval__actions">
          <Button
            disabled={disabled}
            callback={() => onRespond({ kind: 'elicitation', action: 'decline' })}
            label="Decline"
            theme="secondary"
          />
          {interaction.mode === 'form' && (
            <Button
              disabled={disabled}
              callback={submit}
              label={approval ? 'Allow once' : 'Submit'}
              theme="primary"
            />
          )}
          {interaction.mode === 'url' && (
            <>
              <Button disabled={disabled} callback={open} label="Open link" theme="secondary" />
              <Button
                disabled={disabled || !opened}
                callback={() => onRespond({ kind: 'elicitation', action: 'accept' })}
                label="Continue"
                theme="primary"
              />
            </>
          )}
          {interaction.mode === 'verification' && (
            <Button
              disabled={disabled || interaction.availability !== 'available'}
              callback={() => onRespond({ kind: 'elicitation', action: 'accept' })}
              label="Verify identity"
              theme="primary"
            />
          )}
        </div>
      </div>
    </section>
  )
}
