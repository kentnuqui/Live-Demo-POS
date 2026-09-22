import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  formatMoney,
  hasPermission,
  type ModifierGroupDto,
  type ModifierGroupCreateInput,
  type ModifierOptionCreateInput
} from '@towns/shared'
import {
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ApiError, api } from '@/lib/api'
import { canOpenPage, homePath } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'

type Panel =
  | { kind: 'modifier-group'; group: ModifierGroupDto | null }
  | { kind: 'modifier-option'; option: ModifierOptionDto | null; groupId: string }
  | { kind: 'delete-group'; group: ModifierGroupDto }
  | { kind: 'delete-option'; option: ModifierOptionDto }

interface ModifierOptionDto {
  id: string
  modifierGroupId: string
  name: string
  description: string
  priceCents: number
  sortOrder: number
  isActive: boolean
}

/** Modifier Management Interface */
export function ModifiersPage() {
  const user = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)
  if (!user || !hasPermission(user.role, 'settings.manage') || !canOpenPage(user.role, '/menu')) {
    return <Navigate to={homePath(user?.role)} replace />
  }
  if (!branchId) return <p className="p-8 text-sm text-muted-foreground">Choose a branch first</p>
  return <ModifierDesk branchId={branchId} />
}

function ModifierDesk({ branchId }: { branchId: string }) {
  const queryClient = useQueryClient()
  const modifierGroups = useQuery({ 
    queryKey: ['modifier-groups', branchId], 
    queryFn: () => api.modifierGroups(branchId) 
  })
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [groupQuery, setGroupQuery] = useState('')
  const [optionQuery, setOptionQuery] = useState('')
  
  const groups = modifierGroups.data ?? []
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null

  const filteredGroups = useMemo(() => {
    const needle = groupQuery.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(needle) ||
        group.description.toLowerCase().includes(needle)
    )
  }, [groups, groupQuery])

  const filteredOptions = useMemo(() => {
    if (!selectedGroup) return []
    const needle = optionQuery.trim().toLowerCase()
    if (!needle) return selectedGroup.options
    return selectedGroup.options.filter(
      (option) =>
        option.name.toLowerCase().includes(needle) ||
        option.description.toLowerCase().includes(needle)
    )
  }, [selectedGroup, optionQuery])

  const stats = useMemo(() => {
    const totalGroups = groups.length
    const activeGroups = groups.filter((group) => group.isActive).length
    const totalOptions = groups.reduce((sum, group) => sum + group.options.length, 0)
    const activeOptions = groups.reduce(
      (sum, group) => sum + group.options.filter((option) => option.isActive).length,
      0
    )
    return { totalGroups, activeGroups, totalOptions, activeOptions }
  }, [groups])

  function storeGroups(next: ModifierGroupDto[]) {
    queryClient.setQueryData(['modifier-groups', branchId], next)
  }

  // Group mutations
  const toggleGroup = useMutation({
    mutationFn: (group: ModifierGroupDto) => 
      api.updateModifierGroup(branchId, group.id, { isActive: !group.isActive }),
    onSuccess: storeGroups,
    onError: (error) => useToasts.getState().push(failureText(error))
  })

  const removeGroup = useMutation({
    mutationFn: (groupId: string) => api.deleteModifierGroup(branchId, groupId),
    onSuccess: (next) => {
      storeGroups(next)
      setPanel(null)
      useToasts.getState().push('Modifier group deleted')
    },
    onError: (error) => setActionError(failureText(error))
  })

  const saveGroup = useMutation({
    mutationFn: (input: { id: string | null; body: ModifierGroupCreateInput }) =>
      input.id 
        ? api.updateModifierGroup(branchId, input.id, input.body) 
        : api.createModifierGroup(branchId, input.body),
    onSuccess: (next, input) => {
      storeGroups(next)
      if (!input.id) {
        const created = next.find((group) => group.name.toLowerCase() === input.body.name.trim().toLowerCase())
        if (created) setSelectedGroupId(created.id)
      }
      setPanel(null)
      useToasts.getState().push(input.id ? 'Modifier group saved' : 'Modifier group created')
    },
    onError: (error) => setActionError(failureText(error))
  })

  // Option mutations
  const toggleOption = useMutation({
    mutationFn: (option: ModifierOptionDto) => 
      api.updateModifierOption(branchId, option.id, { isActive: !option.isActive }),
    onSuccess: storeGroups,
    onError: (error) => useToasts.getState().push(failureText(error))
  })

  const removeOption = useMutation({
    mutationFn: (optionId: string) => api.deleteModifierOption(branchId, optionId),
    onSuccess: (next) => {
      storeGroups(next)
      setPanel(null)
      useToasts.getState().push('Modifier option deleted')
    },
    onError: (error) => setActionError(failureText(error))
  })

  const saveOption = useMutation({
    mutationFn: (input: { id: string | null; body: ModifierOptionCreateInput }) =>
      input.id 
        ? api.updateModifierOption(branchId, input.id, input.body) 
        : api.createModifierOption(branchId, input.body),
    onSuccess: (next, input) => {
      storeGroups(next)
      setPanel(null)
      useToasts.getState().push(input.id ? 'Modifier option saved' : 'Modifier option created')
    },
    onError: (error) => setActionError(failureText(error))
  })

  function openPanel(next: Panel) {
    setActionError(null)
    saveGroup.reset()
    saveOption.reset()
    setPanel(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-card/25 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl leading-none">Modifier Groups</h1>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {stats.activeGroups} of {stats.totalGroups} groups active · {stats.activeOptions} of {stats.totalOptions} options available
            </p>
          </div>
          <Button onClick={() => openPanel({ kind: 'modifier-group', group: null })}>
            <Plus className="h-4 w-4" />
            New Group
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid h-full min-h-0 grid-cols-[minmax(280px,320px)_minmax(0,1fr)] overflow-hidden">
        {/* Groups Sidebar */}
        <aside className="flex min-h-0 flex-col border-r bg-card/50">
          <div className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={groupQuery}
                onChange={(event) => setGroupQuery(event.target.value)}
                placeholder="Search modifier groups"
                className="h-10 pl-9"
              />
            </div>
          </div>
          
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            {modifierGroups.isLoading ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">Loading groups</p>
            ) : null}
            
            {modifierGroups.isError ? (
              <div className="rounded-2xl border bg-card px-3 py-3 text-sm">
                <p>{failureText(modifierGroups.error)}</p>
                <Button className="mt-3" variant="outline" onClick={() => void modifierGroups.refetch()}>
                  Try again
                </Button>
              </div>
            ) : null}
            
            {!modifierGroups.isLoading && groups.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">No modifier groups yet.</p>
                <Button 
                  className="mt-3" 
                  variant="outline" 
                  onClick={() => openPanel({ kind: 'modifier-group', group: null })}
                >
                  Create first group
                </Button>
              </div>
            ) : null}
            
            {!modifierGroups.isLoading && groups.length > 0 && filteredGroups.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">No groups match that search.</p>
            ) : null}
            
            {filteredGroups.map((group) => {
              const isSelected = selectedGroup?.id === group.id
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setSelectedGroupId(group.id)
                    setOptionQuery('')
                  }}
                  className={cn(
                    'w-full rounded-2xl px-3 py-3 text-left transition',
                    isSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-serif text-lg leading-tight">{group.name}</span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums',
                        isSelected ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {group.options.length}
                    </span>
                  </div>
                  <div className={cn(
                    'mt-1 flex items-center gap-2 text-xs', 
                    isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                  )}>
                    <span className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full', 
                      group.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'
                    )} />
                    {group.isActive ? 'Active' : 'Inactive'}
                    <span aria-hidden>·</span>
                    <span>{group.isRequired ? 'Required' : 'Optional'}</span>
                    {group.isMultipleSelect && (
                      <>
                        <span aria-hidden>·</span>
                        <span>Multi-select</span>
                      </>
                    )}
                  </div>
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Options Content */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {selectedGroup ? (
            <>
              <header className="shrink-0 space-y-3 border-b px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-serif text-3xl">{selectedGroup.name}</h2>
                      <StatusPill active={selectedGroup.isActive} label={selectedGroup.isActive ? 'Active' : 'Inactive'} />
                      {selectedGroup.isRequired && <StatusPill active={true} label="Required" />}
                      {selectedGroup.isMultipleSelect && <StatusPill active={true} label="Multi-select" />}
                    </div>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      {selectedGroup.description || 'No description.'} 
                      {' '}Min: {selectedGroup.minSelections}, Max: {selectedGroup.maxSelections}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <ToolbarIcon
                      label="Edit group"
                      onClick={() => openPanel({ kind: 'modifier-group', group: selectedGroup })}
                    >
                      <Pencil className="h-4 w-4" />
                    </ToolbarIcon>
                    <ToolbarIcon
                      label={selectedGroup.isActive ? 'Deactivate' : 'Activate'}
                      disabled={toggleGroup.isPending}
                      onClick={() => toggleGroup.mutate(selectedGroup)}
                    >
                      {selectedGroup.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </ToolbarIcon>
                    <ToolbarIcon 
                      label="Delete group" 
                      onClick={() => openPanel({ kind: 'delete-group', group: selectedGroup })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </ToolbarIcon>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={optionQuery}
                      onChange={(event) => setOptionQuery(event.target.value)}
                      placeholder={`Search options in ${selectedGroup.name}`}
                      className="h-10 pl-9"
                    />
                  </div>
                  <Button 
                    type="button" 
                    onClick={() => openPanel({ 
                      kind: 'modifier-option', 
                      option: null, 
                      groupId: selectedGroup.id 
                    })}
                  >
                    <Plus className="h-4 w-4" />
                    New Option
                  </Button>
                </div>
              </header>
              
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {selectedGroup.options.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
                    <p className="max-w-sm text-sm text-muted-foreground">
                      This modifier group has no options yet. Add some options to make it useful.
                    </p>
                    <Button 
                      className="mt-4" 
                      onClick={() => openPanel({ 
                        kind: 'modifier-option', 
                        option: null, 
                        groupId: selectedGroup.id 
                      })}
                    >
                      Add First Option
                    </Button>
                  </div>
                ) : null}
                
                {selectedGroup.options.length > 0 && filteredOptions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No options match that search.
                  </p>
                ) : null}
                
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {filteredOptions.map((option) => (
                    <OptionCard
                      key={option.id}
                      option={option}
                      togglePending={toggleOption.isPending}
                      onEdit={() => openPanel({ 
                        kind: 'modifier-option', 
                        option, 
                        groupId: selectedGroup.id 
                      })}
                      onToggle={() => toggleOption.mutate(option)}
                      onDelete={() => openPanel({ kind: 'delete-option', option })}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <Settings className="h-12 w-12 text-muted-foreground/50" />
              <p className="font-serif text-2xl">Choose a modifier group</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {modifierGroups.isLoading 
                  ? 'Loading modifier groups…' 
                  : 'Pick a group on the left to manage its options.'
                }
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Dialogs */}
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open && !saveGroup.isPending && !saveOption.isPending && !removeGroup.isPending && !removeOption.isPending) {
            setPanel(null)
          }
        }}
      >
        <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto">
          {panel?.kind === 'modifier-group' ? (
            <ModifierGroupForm
              key={panel.group?.id ?? 'new-group'}
              group={panel.group}
              pending={saveGroup.isPending}
              error={saveGroup.error ? failureText(saveGroup.error) : actionError}
              onSubmit={(body) => saveGroup.mutate({ id: panel.group?.id ?? null, body })}
            />
          ) : null}
          
          {panel?.kind === 'modifier-option' ? (
            <ModifierOptionForm
              key={panel.option?.id ?? 'new-option'}
              option={panel.option}
              groupId={panel.groupId}
              pending={saveOption.isPending}
              error={saveOption.error ? failureText(saveOption.error) : actionError}
              onSubmit={(body) => saveOption.mutate({ id: panel.option?.id ?? null, body })}
            />
          ) : null}
          
          {panel?.kind === 'delete-group' ? (
            <DeleteGroupForm
              group={panel.group}
              pending={removeGroup.isPending}
              error={actionError}
              onDelete={() => removeGroup.mutate(panel.group.id)}
              onClose={() => setPanel(null)}
            />
          ) : null}
          
          {panel?.kind === 'delete-option' ? (
            <DeleteOptionForm
              option={panel.option}
              pending={removeOption.isPending}
              error={actionError}
              onDelete={() => removeOption.mutate(panel.option.id)}
              onClose={() => setPanel(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Form Components
function ModifierGroupForm({
  group,
  pending,
  error,
  onSubmit
}: {
  group: ModifierGroupDto | null
  pending: boolean
  error: string | null
  onSubmit: (body: ModifierGroupCreateInput) => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [isRequired, setIsRequired] = useState(group?.isRequired ?? false)
  const [isMultipleSelect, setIsMultipleSelect] = useState(group?.isMultipleSelect ?? false)
  const [minSelections, setMinSelections] = useState(String(group?.minSelections ?? 0))
  const [maxSelections, setMaxSelections] = useState(String(group?.maxSelections ?? 1))
  const [isActive, setIsActive] = useState(group?.isActive ?? true)
  const [localError, setLocalError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        const min = Number(minSelections)
        const max = Number(maxSelections)
        
        if (!trimmed) {
          setLocalError('Group name is required')
          return
        }
        if (!Number.isInteger(min) || min < 0) {
          setLocalError('Minimum selections must be 0 or greater')
          return
        }
        if (!Number.isInteger(max) || max < 1) {
          setLocalError('Maximum selections must be 1 or greater')
          return
        }
        if (min > max) {
          setLocalError('Minimum cannot exceed maximum selections')
          return
        }
        if (isRequired && min === 0) {
          setLocalError('Required groups must have minimum selections greater than 0')
          return
        }
        
        setLocalError(null)
        onSubmit({
          name: trimmed,
          description: description.trim(),
          isRequired,
          minSelections: min,
          maxSelections: max,
          isMultipleSelect: isMultipleSelect || max > 1,
          isActive
        })
      }}
    >
      <DialogTitle>{group ? 'Edit Modifier Group' : 'New Modifier Group'}</DialogTitle>
      <DialogDescription>
        Groups organize related modifier options like "Size" or "Add-ons".
      </DialogDescription>
      
      <Field label="Group name">
        <Input 
          value={name} 
          autoFocus 
          maxLength={60} 
          onChange={(event) => setName(event.target.value)} 
          placeholder="e.g., Burger Add-ons, Drink Size"
        />
      </Field>
      
      <Field label="Description">
        <textarea
          value={description}
          maxLength={240}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional description for staff"
          className="min-h-20 w-full rounded-xl border bg-card px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>
      
      <div className="grid grid-cols-2 gap-4">
        <Field label="Minimum selections">
          <Input 
            inputMode="numeric" 
            value={minSelections} 
            onChange={(event) => setMinSelections(event.target.value)} 
          />
        </Field>
        <Field label="Maximum selections">
          <Input 
            inputMode="numeric" 
            value={maxSelections} 
            onChange={(event) => setMaxSelections(event.target.value)} 
          />
        </Field>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Required selection</Label>
          <Switch checked={isRequired} onCheckedChange={setIsRequired} />
        </div>
        <div className="flex items-center justify-between">
          <Label>Multiple selections allowed</Label>
          <Switch checked={isMultipleSelect} onCheckedChange={setIsMultipleSelect} />
        </div>
        <div className="flex items-center justify-between">
          <Label>Active</Label>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>
      
      {localError || error ? (
        <p className="text-sm text-red-600">{localError || error}</p>
      ) : null}
      
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving' : group ? 'Save Changes' : 'Create Group'}
      </Button>
    </form>
  )
}

function ModifierOptionForm({
  option,
  groupId,
  pending,
  error,
  onSubmit
}: {
  option: ModifierOptionDto | null
  groupId: string
  pending: boolean
  error: string | null
  onSubmit: (body: ModifierOptionCreateInput) => void
}) {
  const [name, setName] = useState(option?.name ?? '')
  const [description, setDescription] = useState(option?.description ?? '')
  const [price, setPrice] = useState(option ? (option.priceCents / 100).toFixed(2) : '0.00')
  const [isActive, setIsActive] = useState(option?.isActive ?? true)
  const [localError, setLocalError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        const priceCents = Math.round(parseFloat(price) * 100)
        
        if (!trimmed) {
          setLocalError('Option name is required')
          return
        }
        if (isNaN(priceCents)) {
          setLocalError('Enter a valid price')
          return
        }
        
        setLocalError(null)
        onSubmit({
          modifierGroupId: groupId,
          name: trimmed,
          description: description.trim(),
          priceCents,
          isActive
        })
      }}
    >
      <DialogTitle>{option ? 'Edit Modifier Option' : 'New Modifier Option'}</DialogTitle>
      <DialogDescription>
        Add a specific choice customers can select from this modifier group.
      </DialogDescription>
      
      <Field label="Option name">
        <Input 
          value={name} 
          autoFocus 
          maxLength={60} 
          onChange={(event) => setName(event.target.value)} 
          placeholder="e.g., Extra Cheese, Large Size"
        />
      </Field>
      
      <Field label="Description">
        <Input
          value={description}
          maxLength={240}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional description"
        />
      </Field>
      
      <Field label="Additional price">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input 
            inputMode="decimal" 
            value={price} 
            onChange={(event) => setPrice(event.target.value)} 
            className="pl-8"
            placeholder="0.00"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Use negative values for discounts (e.g., -1.00 for $1 off)
        </p>
      </Field>
      
      <div className="flex items-center justify-between">
        <Label>Active</Label>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </div>
      
      {localError || error ? (
        <p className="text-sm text-red-600">{localError || error}</p>
      ) : null}
      
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving' : option ? 'Save Changes' : 'Create Option'}
      </Button>
    </form>
  )
}

function DeleteGroupForm({
  group,
  pending,
  error,
  onDelete,
  onClose
}: {
  group: ModifierGroupDto
  pending: boolean
  error: string | null
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <DialogTitle>Delete {group.name}?</DialogTitle>
      <DialogDescription>
        This will permanently delete the modifier group and all its options. 
        Past orders will keep their modifier information.
      </DialogDescription>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onDelete}>
          {pending ? 'Deleting' : 'Delete Group'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function DeleteOptionForm({
  option,
  pending,
  error,
  onDelete,
  onClose
}: {
  option: ModifierOptionDto
  pending: boolean
  error: string | null
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <DialogTitle>Delete {option.name}?</DialogTitle>
      <DialogDescription>
        This will permanently delete this modifier option. 
        Past orders will keep their modifier information.
      </DialogDescription>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onDelete}>
          {pending ? 'Deleting' : 'Delete Option'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// Helper Components
function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        active ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-muted-foreground/60')} />
      {label}
    </span>
  )
}

function ToolbarIcon({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button 
      type="button" 
      variant="outline" 
      size="icon" 
      className="h-10 w-10 shrink-0" 
      disabled={disabled} 
      aria-label={label} 
      title={label} 
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function OptionCard({
  option,
  togglePending,
  onEdit,
  onToggle,
  onDelete
}: {
  option: ModifierOptionDto
  togglePending: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <article className="flex flex-col rounded-2xl border bg-gradient-to-br from-muted/40 to-card p-4 shadow-sm transition hover:border-primary/25">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl leading-tight">{option.name}</h3>
          <p className="num mt-1 font-serif text-lg">
            {option.priceCents === 0 ? 'No charge' : 
             option.priceCents > 0 ? `+${formatMoney(option.priceCents, 'USD')}` :
             formatMoney(option.priceCents, 'USD')
            }
          </p>
        </div>
        <StatusPill active={option.isActive} label={option.isActive ? 'Active' : 'Hidden'} />
      </div>
      
      {option.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {option.description}
        </p>
      )}
      
      <div className="mt-4 flex flex-wrap gap-1 border-t pt-3">
        <ToolbarIcon label="Edit option" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon 
          label={option.isActive ? 'Hide option' : 'Show option'} 
          disabled={togglePending} 
          onClick={onToggle}
        >
          {option.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolbarIcon>
        <ToolbarIcon label="Delete option" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </ToolbarIcon>
      </div>
    </article>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function failureText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'The server did not respond. Check the connection and try again.'
    if (Array.isArray(error.details) && error.details.length > 0 && error.message === 'Invalid request') {
      const first = error.details[0]
      if (first && typeof first === 'object' && 'message' in first && typeof first.message === 'string') return first.message
    }
    return error.message
  }
  if (error instanceof TypeError) return 'The server did not respond. Check the connection and try again.'
  return error instanceof Error ? error.message : 'Could not save changes. Try again.'
}