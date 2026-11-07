import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { queryClient, useHealth } from '../api/bot.ts'
import { Segmented, TextField } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ConfirmSheet, Sheet } from '../components/Sheet.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, EmptyState, Pill, Section } from '../components/ui.tsx'
import { fmtTime } from '../format.ts'
import { useConnections, type Connection, type KeyStorage } from '../state/connections.ts'
import { passphraseProblem } from '../state/vault.ts'

const STORAGE: Record<KeyStorage, string> = { passphrase: 'Key under a passphrase', device: 'Remembered on this device', session: 'Key not kept' }

function EditSheet({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const { update, replaceKey } = useConnections()
  const [storage, setStorage] = useState<KeyStorage>(connection.storage)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ mode: 'onTouched', defaultValues: { name: connection.name, url: connection.url, key: '', passphrase: '' } })

  const save = handleSubmit(async (values) => {
    await update(connection.id, { name: values.name, url: values.url })
    const current = useConnections.getState().keys[connection.id]
    const key = values.key.trim() || current
    if (key && (values.key.trim() || storage !== connection.storage)) await replaceKey(connection.id, key, storage, values.passphrase)
    queryClient.removeQueries({ queryKey: ['bot', connection.id] })
    toast.success('Saved', connection.name)
    onClose()
  })

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Edit ${connection.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={isSubmitting} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className="form" noValidate onSubmit={save}>
        <TextField id="e-name" label="Name" registration={register('name', { required: 'Give it a name.' })} error={errors.name?.message} />
        <TextField id="e-url" label="Address" inputMode="url" registration={register('url', { required: 'Enter the bot’s address.' })} error={errors.url?.message} />
        <TextField
          id="e-key"
          label="New API key (optional)"
          type="password"
          mono
          hint="Leave empty to keep the current key."
          registration={register('key', { validate: (value) => !value || value.trim().length >= 32 || 'The API key has at least 32 characters.' })}
          error={errors.key?.message}
        />
        <Segmented
          name="e-storage"
          legend="Keep the key"
          value={storage}
          onChange={setStorage}
          options={[
            { value: 'passphrase', label: 'With a passphrase' },
            { value: 'device', label: 'Without' },
            { value: 'session', label: 'Don’t keep it' },
          ]}
        />
        {storage === 'passphrase' ? (
          <TextField
            id="e-pass"
            label="Passphrase"
            type="password"
            autoComplete="new-password"
            hint="Needed to seal the key again."
            registration={register('passphrase', { validate: (value, all) => (storage !== 'passphrase' || (!all.key && storage === connection.storage) ? true : (passphraseProblem(value) ?? true)) })}
            error={errors.passphrase?.message}
          />
        ) : null}
      </form>
    </Sheet>
  )
}

export default function Connections() {
  const { connections, activeId, keys, setActive, remove, lock, remember } = useConnections()
  const health = useHealth((state) => state.byId)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [forgetting, setForgetting] = useState<Connection | null>(null)
  const unlocked = connections.some((c) => c.storage !== 'device' && keys[c.id])

  return (
    <>
      <ScreenHead
        kicker="Connections"
        title="Your bots."
        lead="Each bot is an address and an API key. This device remembers them as you chose."
        actions={
          <>
            <Link to="/connect" className="btn btn-solid">
              Add a bot
            </Link>
            {unlocked ? (
              <Button variant="ghost" icon="lock" onClick={lock}>
                Lock now
              </Button>
            ) : null}
          </>
        }
      />
      <Section variant="alt" label="Saved bots">
        {connections.length ? (
          <ul className="rows">
            {connections.map((connection) => {
              const state = health[connection.id]
              return (
                <li key={connection.id}>
                  <div className="spread">
                    <div className="stack-sm grow">
                      <p className="h3">{connection.name}</p>
                      <p className="mono small">{connection.url}</p>
                      <div className="pills">
                        {connection.id === activeId ? <Pill tone="solid">In use</Pill> : null}
                        <Pill>{connection.relock ? 'Locked by you' : STORAGE[connection.storage]}</Pill>
                        {keys[connection.id] ? <Pill>Unlocked</Pill> : <Pill>Locked</Pill>}
                        {state?.unauthorized ? <Pill tone="accent">Key refused</Pill> : state?.unreachable ? <Pill tone="accent">Unreachable</Pill> : null}
                      </div>
                      <p className="small mute">Added {fmtTime(connection.addedAt)} UTC</p>
                    </div>
                    <div className="btn-row">
                      {connection.id !== activeId ? (
                        <Button compact onClick={() => void setActive(connection.id)}>
                          Use
                        </Button>
                      ) : null}
                      {keys[connection.id] && connection.storage !== 'device' ? (
                        <Button
                          compact
                          variant="ghost"
                          onClick={() =>
                            void remember(connection.id).then(() => toast.success('Remembered', `${connection.name} opens without a passphrase on this device. More → Lock the bot locks it.`))
                          }
                        >
                          Remember me
                        </Button>
                      ) : null}
                      <Button compact variant="ghost" onClick={() => setEditing(connection)}>
                        Edit
                      </Button>
                      <Button compact variant="ghost" icon="trash" onClick={() => setForgetting(connection)}>
                        Forget
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState title="No bot yet." actions={<Link to="/connect" className="btn btn-solid">Connect your bot</Link>}>
            Add your bot’s address and API key to start.
          </EmptyState>
        )}
      </Section>
      {editing ? <EditSheet connection={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmSheet
        open={forgetting !== null}
        onClose={() => setForgetting(null)}
        title="Forget this bot?"
        intro="This device forgets the address, the key and everything it remembered about this bot: last answers, the tick feed, saved backtests, the activity log. The bot itself is not touched."
        review={forgetting ? [['Bot', forgetting.name], ['Address', forgetting.url]] : []}
        confirmLabel="Forget"
        danger
        onConfirm={async () => {
          if (!forgetting) return
          queryClient.removeQueries({ queryKey: ['bot', forgetting.id] })
          await remove(forgetting.id)
          toast.info('Forgotten', forgetting.name)
        }}
      />
    </>
  )
}
