import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MENU_STATIONS,
  formatMoney,
  hasPermission,
  minorExponent,
  type CategoryCreateInput,
  type MenuCategoryDto,
  type MenuItemDto,
  type MenuItemCreateInput,
  type MenuStation,
} from '@towns/shared'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderInput,
  Link,
  Pencil,
  Plus,
  Search,
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
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'
import { MenuItemModifiersDialog } from '@/features/modifiers/menu-item-modifiers'

const STATION_LABEL: Record<MenuStation, string> = {
  KITCHEN: 'Kitchen',
  SUSHI: 'Sushi',
  BAR: 'Bar',
  DESSERT: 'Dessert'
}

type Panel =
  | { kind: 'category'; category: MenuCategoryDto | null }
  | { kind: 'item'; item: MenuItemDto | null }
  | { kind: 'move'; item: MenuItemDto }
  | { kind: 'assign' }
  | { kind: 'delete-category'; category: MenuCategoryDto }
  | { kind: 'delete-item'; item: MenuItemDto }

/** Category and dish editor. The cashier reads the same rows. */
export function MenuPage() {
  const user = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)
  if (!user || !hasPermission(user.role, 'settings.manage') || !canOpenPage(user.role, '/menu')) {
    return <Navigate to={homePath(user?.role)} replace />
  }
  if (!branchId) return <p className="p-8 text-sm text-muted-foreground">Choose a branch first</p>
  return <MenuDesk branchId={branchId} />
}

function MenuDesk({ branchId }: { branchId: string }) {
  const queryClient = useQueryClient()
  const catalog = useQuery({ queryKey: ['menu-manage', branchId], queryFn: () => api.menuManage(branchId) })
  const settings = useQuery({
    queryKey: ['settings', branchId],
    queryFn: () => cached(`settings:${branchId}`, () => api.settings(branchId))
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [categoryQuery, setCategoryQuery] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [modifierDialog, setModifierDialog] = useState<{ isOpen: boolean; item: MenuItemDto | null }>({
    isOpen: false,
    item: null
  })
  const categories = catalog.data ?? []
  const selected = categories.find((category) => category.id === selectedId) ?? categories[0] ?? null
  const selectedIndex = selected ? categories.findIndex((category) => category.id === selected.id) : -1
  const currency = settings.data?.currency ?? 'USD'

  const filteredCategories = useMemo(() => {
    const needle = categoryQuery.trim().toLowerCase()
    if (!needle) return categories
    return categories.filter(
      (category) =>
        category.name.toLowerCase().includes(needle) ||
        (category.description?.toLowerCase().includes(needle) ?? false)
    )
  }, [categories, categoryQuery])

  const filteredItems = useMemo(() => {
    if (!selected) return []
    const needle = itemQuery.trim().toLowerCase()
    if (!needle) return selected.items
    return selected.items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.description?.toLowerCase().includes(needle) ?? false) ||
        STATION_LABEL[item.station].toLowerCase().includes(needle)
    )
  }, [selected, itemQuery])

  const stats = useMemo(() => {
    const itemCount = categories.reduce((sum, category) => sum + category.items.length, 0)
    const activeCategories = categories.filter((category) => category.isActive).length
    const activeItems = categories.reduce(
      (sum, category) => sum + category.items.filter((item) => item.isAvailable).length,
      0
    )
    return { itemCount, activeCategories, activeItems }
  }, [categories])

  function store(next: MenuCategoryDto[]) {
    queryClient.setQueryData(['menu-manage', branchId], next)
  }

  const reorderCategories = useMutation({
    mutationFn: (ids: string[]) => api.reorderCategories(branchId, ids),
    onSuccess: store,
    onError: (error) => useToasts.getState().push(failureText(error))
  })
  const reorderItems = useMutation({
    mutationFn: (ids: string[]) => {
      if (!selected) throw new Error('Choose a category first')
      return api.reorderMenuItems(branchId, selected.id, ids)
    },
    onSuccess: store,
    onError: (error) => useToasts.getState().push(failureText(error))
  })
  const toggleCategory = useMutation({
    mutationFn: (category: MenuCategoryDto) => api.updateCategory(branchId, category.id, { isActive: !category.isActive }),
    onSuccess: store,
    onError: (error) => useToasts.getState().push(failureText(error))
  })
  const toggleItem = useMutation({
    mutationFn: (item: MenuItemDto) => api.updateMenuItem(branchId, item.id, { isAvailable: !item.isAvailable }),
    onSuccess: store,
    onError: (error) => useToasts.getState().push(failureText(error))
  })
  const removeCategory = useMutation({
    mutationFn: (categoryId: string) => api.deleteCategory(branchId, categoryId),
    onSuccess: (next) => {
      store(next)
      setPanel(null)
      useToasts.getState().push('Category deleted')
    },
    onError: (error) => setActionError(failureText(error))
  })
  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.deleteMenuItem(branchId, itemId),
    onSuccess: (next) => {
      store(next)
      setPanel(null)
      useToasts.getState().push('Item deleted')
    },
    onError: (error) => setActionError(failureText(error))
  })
  const saveCategory = useMutation({
    mutationFn: (input: { id: string | null; body: CategoryCreateInput }) =>
      input.id ? api.updateCategory(branchId, input.id, input.body) : api.createCategory(branchId, input.body),
    onSuccess: (next, input) => {
      store(next)
      if (!input.id) {
        const created = next.find((category) => category.name.toLowerCase() === input.body.name.trim().toLowerCase())
        if (created) setSelectedId(created.id)
      }
      setPanel(null)
      useToasts.getState().push(input.id ? 'Category saved' : 'Category added')
    }
  })
  const saveItem = useMutation({
    mutationFn: (input: { id: string | null; body: MenuItemCreateInput }) =>
      input.id ? api.updateMenuItem(branchId, input.id, input.body) : api.createMenuItem(branchId, input.body),
    onSuccess: (next, input) => {
      store(next)
      setPanel(null)
      useToasts.getState().push(input.id ? 'Item saved' : 'Item added')
    }
  })
  const moveItem = useMutation({
    mutationFn: (input: { itemId: string; categoryId: string }) => api.updateMenuItem(branchId, input.itemId, { categoryId: input.categoryId }),
    onSuccess: (next, input) => {
      store(next)
      setSelectedId(input.categoryId)
      setPanel(null)
      useToasts.getState().push('Item moved')
    }
  })

  function open(next: Panel) {
    setActionError(null)
    saveCategory.reset()
    saveItem.reset()
    moveItem.reset()
    setPanel(next)
  }

  const elsewhere = categories.flatMap((category) =>
    category.id === selected?.id
      ? []
      : category.items.map((item) => ({ ...item, categoryName: category.name }))
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(240px,300px)_minmax(0,1fr)] overflow-hidden">
      <aside className="flex min-h-0 flex-col border-r bg-card/50">
        <header className="space-y-3 px-4 pb-3 pt-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-serif text-3xl leading-none">Menu</h1>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {stats.activeCategories} active categories · {stats.activeItems} of {stats.itemCount} items on the cashier
              </p>
            </div>
            <Button size="icon" aria-label="New category" onClick={() => open({ kind: 'category', category: null })}>
              <Plus className="h-5 w-5" />
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={categoryQuery}
              onChange={(event) => setCategoryQuery(event.target.value)}
              placeholder="Search categories"
              className="h-10 pl-9"
            />
          </div>
        </header>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {catalog.isLoading ? <p className="px-2 py-2 text-sm text-muted-foreground">Loading categories</p> : null}
          {catalog.isError ? (
            <div className="rounded-2xl border bg-card px-3 py-3 text-sm">
              <p>{failureText(catalog.error)}</p>
              <Button className="mt-3" variant="outline" onClick={() => void catalog.refetch()}>
                Try again
              </Button>
            </div>
          ) : null}
          {!catalog.isLoading && categories.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">No categories yet.</p>
              <Button className="mt-3" variant="outline" onClick={() => open({ kind: 'category', category: null })}>
                Create first category
              </Button>
            </div>
          ) : null}
          {!catalog.isLoading && categories.length > 0 && filteredCategories.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No categories match that search.</p>
          ) : null}
          {filteredCategories.map((category) => {
            const isSelected = selected?.id === category.id
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setSelectedId(category.id)
                  setItemQuery('')
                }}
                className={cn(
                  'w-full rounded-2xl px-3 py-3 text-left transition',
                  isSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{category.name}</span>
                  <span
                    className={cn(
                      'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums',
                      isSelected ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {category.items.length}
                  </span>
                </div>
                <div className={cn('mt-1 flex items-center gap-2 text-xs', isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', category.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
                  {category.isActive ? 'On cashier' : 'Hidden'}
                  <span aria-hidden>·</span>
                  <span>#{category.sortOrder + 1}</span>
                </div>
              </button>
            )
          })}
        </nav>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {selected ? (
          <>
            <header className="shrink-0 space-y-3 border-b px-5 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-serif text-3xl">{selected.name}</h2>
                    <StatusPill active={selected.isActive} label={selected.isActive ? 'On cashier' : 'Hidden'} />
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {selected.description || 'No description yet.'} Updated {stamp(selected.updatedAt)}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <ToolbarIcon
                    label="Move category up"
                    disabled={selectedIndex <= 0 || reorderCategories.isPending}
                    onClick={() => {
                      const ids = shift(categories, selectedIndex, -1)
                      if (ids) reorderCategories.mutate(ids)
                    }}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </ToolbarIcon>
                  <ToolbarIcon
                    label="Move category down"
                    disabled={selectedIndex < 0 || selectedIndex >= categories.length - 1 || reorderCategories.isPending}
                    onClick={() => {
                      const ids = shift(categories, selectedIndex, 1)
                      if (ids) reorderCategories.mutate(ids)
                    }}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </ToolbarIcon>
                  <ToolbarIcon label="Edit category" onClick={() => open({ kind: 'category', category: selected })}>
                    <Pencil className="h-4 w-4" />
                  </ToolbarIcon>
                  <ToolbarIcon
                    label={selected.isActive ? 'Hide from cashier' : 'Show on cashier'}
                    disabled={toggleCategory.isPending}
                    onClick={() => toggleCategory.mutate(selected)}
                  >
                    {selected.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </ToolbarIcon>
                  <ToolbarIcon label="Delete category" onClick={() => open({ kind: 'delete-category', category: selected })}>
                    <Trash2 className="h-4 w-4" />
                  </ToolbarIcon>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={itemQuery}
                    onChange={(event) => setItemQuery(event.target.value)}
                    placeholder={`Search items in ${selected.name}`}
                    className="h-10 pl-9"
                  />
                </div>
                <Button type="button" variant="outline" onClick={() => open({ kind: 'assign' })} disabled={elsewhere.length === 0}>
                  <FolderInput className="h-4 w-4" />
                  Assign existing
                </Button>
                <Button type="button" onClick={() => open({ kind: 'item', item: null })}>
                  <Plus className="h-4 w-4" />
                  New item
                </Button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {selected.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
                  <p className="max-w-sm text-sm text-muted-foreground">
                    This category is empty. Add a new dish or assign one from another category.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button type="button" variant="outline" onClick={() => open({ kind: 'assign' })} disabled={elsewhere.length === 0}>
                      Assign existing
                    </Button>
                    <Button type="button" onClick={() => open({ kind: 'item', item: null })}>
                      New item
                    </Button>
                  </div>
                </div>
              ) : null}
              {selected.items.length > 0 && filteredItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No items match that search.</p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {filteredItems.map((item) => {
                  const index = selected.items.findIndex((row) => row.id === item.id)
                  return (
                    <ItemCard
                      key={item.id}
                      item={item}
                      currency={currency}
                      canMove={categories.length >= 2}
                      reorderPending={reorderItems.isPending}
                      togglePending={toggleItem.isPending}
                      isFirst={index <= 0}
                      isLast={index < 0 || index >= selected.items.length - 1}
                      onMoveUp={() => {
                        const ids = shift(selected.items, index, -1)
                        if (ids) reorderItems.mutate(ids)
                      }}
                      onMoveDown={() => {
                        const ids = shift(selected.items, index, 1)
                        if (ids) reorderItems.mutate(ids)
                      }}
                      onEdit={() => open({ kind: 'item', item })}
                      onMove={() => open({ kind: 'move', item })}
                      onAssignModifiers={() => setModifierDialog({ isOpen: true, item })}
                      onToggle={() => toggleItem.mutate(item)}
                      onDelete={() => open({ kind: 'delete-item', item })}
                    />
                  )
                })}
              </div>
            </div>
            <CashierPreview category={selected} currency={currency} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="font-serif text-2xl">Choose a category</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {catalog.isLoading ? 'Loading your menu…' : 'Pick a category on the left to edit dishes and see how they appear on the cashier.'}
            </p>
          </div>
        )}
      </section>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open && !saveCategory.isPending && !saveItem.isPending && !moveItem.isPending && !removeCategory.isPending && !removeItem.isPending) {
            setPanel(null)
          }
        }}
      >
        <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto">
          {panel?.kind === 'category' ? (
            <CategoryForm
              key={panel.category?.id ?? 'new-category'}
              category={panel.category}
              nextDisplay={nextDisplay(categories)}
              pending={saveCategory.isPending}
              error={saveCategory.error ? failureText(saveCategory.error) : null}
              onSubmit={(body) => saveCategory.mutate({ id: panel.category?.id ?? null, body })}
            />
          ) : null}
          {panel?.kind === 'item' && selected ? (
            <ItemForm
              key={panel.item?.id ?? 'new-item'}
              item={panel.item}
              categoryId={panel.item?.categoryId ?? selected.id}
              currency={currency}
              nextDisplay={nextDisplay(selected.items)}
              pending={saveItem.isPending}
              error={saveItem.error ? failureText(saveItem.error) : null}
              onSubmit={(body) => saveItem.mutate({ id: panel.item?.id ?? null, body })}
            />
          ) : null}
          {panel?.kind === 'move' ? (
            <MoveForm
              key={panel.item.id}
              item={panel.item}
              categories={categories}
              pending={moveItem.isPending}
              error={moveItem.error ? failureText(moveItem.error) : null}
              onSubmit={(categoryId) => moveItem.mutate({ itemId: panel.item.id, categoryId })}
            />
          ) : null}
          {panel?.kind === 'assign' && selected ? (
            <AssignForm
              key={selected.id}
              categoryName={selected.name}
              items={elsewhere}
              pending={moveItem.isPending}
              error={moveItem.error ? failureText(moveItem.error) : null}
              onSubmit={(itemId) => moveItem.mutate({ itemId, categoryId: selected.id })}
            />
          ) : null}
          {panel?.kind === 'delete-category' ? (
            <DeleteCategory
              category={panel.category}
              pending={removeCategory.isPending}
              error={actionError}
              onDelete={() => removeCategory.mutate(panel.category.id)}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {panel?.kind === 'delete-item' ? (
            <DeleteItem
              item={panel.item}
              pending={removeItem.isPending}
              error={actionError}
              onDelete={() => removeItem.mutate(panel.item.id)}
              onClose={() => setPanel(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      
      <MenuItemModifiersDialog
        isOpen={modifierDialog.isOpen}
        onClose={() => setModifierDialog({ isOpen: false, item: null })}
        menuItem={modifierDialog.item}
        branchId={branchId}
      />
    </div>
  )
}

function CategoryForm({
  category,
  nextDisplay,
  pending,
  error,
  onSubmit
}: {
  category: MenuCategoryDto | null
  nextDisplay: number
  pending: boolean
  error: string | null
  onSubmit: (body: CategoryCreateInput) => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [active, setActive] = useState(category?.isActive ?? true)
  const [display, setDisplay] = useState(String(category ? category.sortOrder + 1 : nextDisplay))
  const [localError, setLocalError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        const position = Number(display)
        if (!trimmed) {
          setLocalError('Category name is required')
          return
        }
        if (!Number.isInteger(position) || position < 1 || position > 10_000) {
          setLocalError('Display order must be a whole number from 1 upward')
          return
        }
        setLocalError(null)
        onSubmit({
          name: trimmed,
          description: description.trim(),
          isActive: active,
          sortOrder: position - 1
        })
      }}
    >
      <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
      <DialogDescription>This name is what the cashier sees on the category bar.</DialogDescription>
      <Field label="Category name">
        <Input value={name} autoFocus maxLength={60} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          maxLength={240}
          onChange={(event) => setDescription(event.target.value)}
          className="min-h-24 w-full rounded-xl border bg-card px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>
      <div className="flex items-center justify-between gap-4">
        <Label>Active on the cashier</Label>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>
      <Field label="Display order">
        <Input inputMode="numeric" value={display} onChange={(event) => setDisplay(event.target.value)} />
      </Field>
      {localError || error ? <p className="text-sm text-accent">{localError || error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving' : 'Save category'}
      </Button>
    </form>
  )
}

function ItemForm({
  item,
  categoryId,
  currency,
  nextDisplay,
  pending,
  error,
  onSubmit
}: {
  item: MenuItemDto | null
  categoryId: string
  currency: string
  nextDisplay: number
  pending: boolean
  error: string | null
  onSubmit: (body: MenuItemCreateInput) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item ? fromMinor(item.priceCents, currency) : '')
  const [station, setStation] = useState<MenuStation>(item?.station ?? 'KITCHEN')
  const [active, setActive] = useState(item?.isAvailable ?? true)
  const [display, setDisplay] = useState(String(item ? item.sortOrder + 1 : nextDisplay))
  const [localError, setLocalError] = useState<string | null>(null)
  const exponent = minorExponent(currency)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        const minor = toMinor(price, currency)
        const position = Number(display)
        if (!trimmed) {
          setLocalError('Item name is required')
          return
        }
        if (minor === null) {
          setLocalError(exponent === 0 ? 'Enter a whole-number price' : `Enter a price with up to ${exponent} decimal places`)
          return
        }
        if (!Number.isInteger(position) || position < 1 || position > 10_000) {
          setLocalError('Display order must be a whole number from 1 upward')
          return
        }
        setLocalError(null)
        onSubmit({
          categoryId,
          name: trimmed,
          description: description.trim(),
          priceCents: minor,
          station,
          isAvailable: active,
          sortOrder: position - 1
        })
      }}
    >
      <DialogTitle>{item ? 'Edit item' : 'New item'}</DialogTitle>
      <DialogDescription>The dish stays one record. Its category only decides where the cashier shows it.</DialogDescription>
      <Field label="Item name">
        <Input value={name} autoFocus maxLength={80} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          maxLength={240}
          onChange={(event) => setDescription(event.target.value)}
          className="min-h-20 w-full rounded-xl border bg-card px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>
      <Field label={`Price (${currency})`}>
        <Input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
      </Field>
      <Field label="Station">
        <select
          value={station}
          onChange={(event) => setStation(event.target.value as MenuStation)}
          className="h-12 w-full rounded-xl border bg-card px-3 text-base"
        >
          {MENU_STATIONS.map((value) => (
            <option key={value} value={value}>
              {STATION_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-center justify-between gap-4">
        <Label>Active on the cashier</Label>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>
      <Field label="Display order">
        <Input inputMode="numeric" value={display} onChange={(event) => setDisplay(event.target.value)} />
      </Field>
      {localError || error ? <p className="text-sm text-accent">{localError || error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving' : 'Save item'}
      </Button>
    </form>
  )
}

function MoveForm({
  item,
  categories,
  pending,
  error,
  onSubmit
}: {
  item: MenuItemDto
  categories: MenuCategoryDto[]
  pending: boolean
  error: string | null
  onSubmit: (categoryId: string) => void
}) {
  const choices = categories.filter((category) => category.id !== item.categoryId)
  const [categoryId, setCategoryId] = useState(choices[0]?.id ?? '')
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (categoryId) onSubmit(categoryId)
      }}
    >
      <DialogTitle>Move {item.name}</DialogTitle>
      <DialogDescription>The dish moves. It is not copied, and past tickets keep the original name and price.</DialogDescription>
      <Field label="Category">
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="h-12 w-full rounded-xl border bg-card px-3 text-base"
        >
          {choices.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      <Button type="submit" disabled={pending || !categoryId}>
        {pending ? 'Moving' : 'Move item'}
      </Button>
    </form>
  )
}

function AssignForm({
  categoryName,
  items,
  pending,
  error,
  onSubmit
}: {
  categoryName: string
  items: Array<MenuItemDto & { categoryName: string }>
  pending: boolean
  error: string | null
  onSubmit: (itemId: string) => void
}) {
  const [itemId, setItemId] = useState(items[0]?.id ?? '')
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (itemId) onSubmit(itemId)
      }}
    >
      <DialogTitle>Assign to {categoryName}</DialogTitle>
      <DialogDescription>Choose a dish from another category. It will leave that category.</DialogDescription>
      <Field label="Existing item">
        <select
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          className="h-12 w-full rounded-xl border bg-card px-3 text-base"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.categoryName}
            </option>
          ))}
        </select>
      </Field>
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      <Button type="submit" disabled={pending || !itemId}>
        {pending ? 'Assigning' : 'Assign item'}
      </Button>
    </form>
  )
}

function DeleteCategory({
  category,
  pending,
  error,
  onDelete,
  onClose
}: {
  category: MenuCategoryDto
  pending: boolean
  error: string | null
  onDelete: () => void
  onClose: () => void
}) {
  const blocked = category.items.length > 0
  return (
    <div className="space-y-4">
      <DialogTitle>{blocked ? 'Move items first' : `Delete ${category.name}`}</DialogTitle>
      <DialogDescription>
        {blocked
          ? `"${category.name}" has ${category.items.length} ${category.items.length === 1 ? 'item' : 'items'}. Move them to another category before deleting this one. Deleting a category does not remove past sales.`
          : `"${category.name}" has no menu items. Past sales stay as they are.`}
      </DialogDescription>
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      <div className="flex gap-2">
        {blocked ? (
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        ) : (
          <Button type="button" disabled={pending} onClick={onDelete}>
            {pending ? 'Deleting' : 'Delete category'}
          </Button>
        )}
      </div>
    </div>
  )
}

function DeleteItem({
  item,
  pending,
  error,
  onDelete,
  onClose
}: {
  item: MenuItemDto
  pending: boolean
  error: string | null
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <DialogTitle>Delete {item.name}</DialogTitle>
      <DialogDescription>
        If this dish has been sold, it stays on file so receipts and reports keep it. Deactivate it to hide it from the cashier.
      </DialogDescription>
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={onDelete}>
          {pending ? 'Deleting' : 'Delete item'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

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
    <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" disabled={disabled} aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  )
}

function ItemCard({
  item,
  currency,
  canMove,
  reorderPending,
  togglePending,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onMove,
  onAssignModifiers,
  onToggle,
  onDelete
}: {
  item: MenuItemDto
  currency: string
  canMove: boolean
  reorderPending: boolean
  togglePending: boolean
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onMove: () => void
  onAssignModifiers: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <article className="flex flex-col rounded-2xl border bg-gradient-to-br from-muted/40 to-card p-4 shadow-sm transition hover:border-primary/25">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl leading-tight">{item.name}</h3>
          <p className="num mt-1 text-sm text-muted-foreground">{formatMoney(item.priceCents, currency)}</p>
        </div>
        <StatusPill active={item.isAvailable} label={item.isAvailable ? 'Active' : 'Hidden'} />
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {STATION_LABEL[item.station]} · order {item.sortOrder + 1}
        {item.description ? ` · ${item.description}` : ''}
      </p>
      <div className="mt-4 flex flex-wrap gap-1 border-t pt-3">
        <ToolbarIcon label="Move item up" disabled={isFirst || reorderPending} onClick={onMoveUp}>
          <ChevronUp className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon label="Move item down" disabled={isLast || reorderPending} onClick={onMoveDown}>
          <ChevronDown className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon label="Edit item" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon label="Move to another category" disabled={!canMove} onClick={onMove}>
          <FolderInput className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon label="Assign modifiers" onClick={onAssignModifiers}>
          <Link className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon label={item.isAvailable ? 'Hide from cashier' : 'Show on cashier'} disabled={togglePending} onClick={onToggle}>
          {item.isAvailable ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolbarIcon>
        <ToolbarIcon label="Delete item" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </ToolbarIcon>
      </div>
    </article>
  )
}

/** Mirrors the cashier category bar and dish grid for the selected category. */
function CashierPreview({ category, currency }: { category: MenuCategoryDto; currency: string }) {
  const visibleItems = category.isActive ? category.items.filter((item) => item.isAvailable) : []
  return (
    <section className="shrink-0 border-t bg-muted/25 px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Cashier preview</p>
      {!category.isActive ? (
        <p className="mt-2 text-sm text-muted-foreground">This category is hidden on the cashier until you turn it on.</p>
      ) : (
        <>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-sm text-primary-foreground">{category.name}</span>
          </div>
          {visibleItems.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No active items to show in this category.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {visibleItems.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-[72px] flex-col justify-between rounded-xl border bg-card/80 px-2.5 py-2 text-left"
                >
                  <span className="line-clamp-2 font-serif text-sm leading-tight">{item.name}</span>
                  <span className="num text-[11px] text-muted-foreground">{formatMoney(item.priceCents, currency)}</span>
                </div>
              ))}
            </div>
          )}
          {visibleItems.length > 6 ? (
            <p className="mt-2 text-xs text-muted-foreground">+ {visibleItems.length - 6} more dishes on the cashier grid</p>
          ) : null}
        </>
      )}
    </section>
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

function shift(rows: Array<{ id: string }>, index: number, direction: -1 | 1): string[] | null {
  const next = index + direction
  if (next < 0 || next >= rows.length) return null
  const ids = rows.map((row) => row.id)
  const current = ids[index]
  const swap = ids[next]
  if (!current || !swap) return null
  ids[index] = swap
  ids[next] = current
  return ids
}

function nextDisplay(rows: Array<{ sortOrder: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 2
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function toMinor(raw: string, currency: string): number | null {
  const exponent = minorExponent(currency)
  const normalized = raw.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > exponent) return null
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0')
  if (!Number.isSafeInteger(minor) || minor > 10_000_000) return null
  return minor
}

function fromMinor(minor: number, currency: string): string {
  const exponent = minorExponent(currency)
  if (exponent === 0) return String(minor)
  return (minor / 10 ** exponent).toFixed(exponent)
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
  return error instanceof Error ? error.message : 'The menu could not be saved. Try again.'
}
