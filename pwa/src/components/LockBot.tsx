import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useBot } from '../api/bot.ts'
import { useConnections } from '../state/connections.ts'
import { passphraseProblem } from '../state/vault.ts'
import { TextField } from './Field.tsx'
import { Sheet } from './Sheet.tsx'
import { toast } from './Toasts.tsx'
import { Button } from './ui.tsx'

/**
 * Locks the bot in use on this device. A remembered bot (remember me) needs a passphrase to lock with: its key is
 * sealed under it until it is unlocked, and then remembered again. A bot kept with a passphrase just forgets the key.
 */
export function LockBot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connection } = useBot()
  const lockWith = useConnections((state) => state.lockWith)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState } = useForm({ mode: 'onTouched', defaultValues: { passphrase: '', confirm: '' } })
  if (!connection) return null
  const remembered = connection.storage === 'device'

  const lock = handleSubmit(async ({ passphrase }) => {
    setFailure(null)
    try {
      await lockWith(connection.id, remembered ? passphrase : null)
      reset()
      onClose()
      toast.info('Locked', `${connection.name} is locked on this device.`)
    } catch (error) {
      setFailure(String((error as Error)?.message ?? error))
    }
  })

  return (
    <Sheet open={open} onClose={onClose} title="Lock the bot">
      <form className="form" noValidate onSubmit={lock}>
        <p className="p">
          {remembered
            ? `${connection.name} opens without a passphrase on this device. Choose one to lock it with: until it is typed, nobody can use the bot from this device. Once unlocked, it is remembered again.`
            : `${connection.name} forgets its key until the passphrase is typed again.`}
        </p>
        {remembered ? (
          <div className="form-grid">
            <TextField
              id="lock-pass"
              label="Passphrase"
              type="password"
              autoComplete="new-password"
              error={formState.errors.passphrase?.message}
              registration={register('passphrase', { validate: (value) => passphraseProblem(value) ?? true })}
            />
            <TextField
              id="lock-confirm"
              label="Passphrase again"
              type="password"
              autoComplete="new-password"
              error={formState.errors.confirm?.message}
              registration={register('confirm', { validate: (value, all) => value === all.passphrase || 'The two passphrases differ.' })}
            />
          </div>
        ) : null}
        {failure ? <p className="field-error">{failure}</p> : null}
        <div className="btn-row">
          <Button type="submit" icon="lock" busy={formState.isSubmitting}>
            Lock the bot
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
