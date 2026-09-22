import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type MenuItemDto
} from '@towns/shared'
import { Check, Link, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useToasts } from '@/stores/toast-store'

interface MenuItemModifiersDialogProps {
  isOpen: boolean
  onClose: () => void
  menuItem: MenuItemDto | null
  branchId: string
}

export function MenuItemModifiersDialog({
  isOpen,
  onClose,
  menuItem,
  branchId
}: MenuItemModifiersDialogProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())

  const modifierGroups = useQuery({
    queryKey: ['modifier-groups', branchId],
    queryFn: () => api.modifierGroups(branchId),
    enabled: isOpen && !!branchId
  })

  const groups = modifierGroups.data ?? []
  const activeGroups = groups.filter(group => group.isActive)

  // Initialize selected groups when menu item changes
  useEffect(() => {
    if (menuItem?.modifierGroups) {
      setSelectedGroupIds(new Set(menuItem.modifierGroups.map(g => g.id)))
    } else {
      setSelectedGroupIds(new Set())
    }
  }, [menuItem?.id])

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return activeGroups
    return activeGroups.filter(group =>
      group.name.toLowerCase().includes(needle) ||
      group.description.toLowerCase().includes(needle)
    )
  }, [activeGroups, search])

  const assignMutation = useMutation({
    mutationFn: (groupIds: string[]) => {
      if (!menuItem) throw new Error('No menu item selected')
      return api.assignModifierGroups(branchId, menuItem.id, { modifierGroupIds: groupIds })
    },
    onSuccess: (updatedCategories) => {
      // Update the menu cache with the new modifier assignments
      queryClient.setQueryData(['menu-manage', branchId], updatedCategories)
      queryClient.invalidateQueries({ queryKey: ['menu', branchId] })
      useToasts.getState().push('Modifier groups assigned successfully')
      onClose()
    },
    onError: (error) => {
      useToasts.getState().push(failureText(error))
    }
  })

  const handleToggleGroup = (groupId: string) => {
    setSelectedGroupIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId)
      } else {
        newSet.add(groupId)
      }
      return newSet
    })
  }

  const handleSave = () => {
    assignMutation.mutate(Array.from(selectedGroupIds))
  }

  const handleClose = () => {
    setSearch('')
    setSelectedGroupIds(new Set())
    onClose()
  }

  if (!menuItem) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
        <DialogTitle>
          <div className="flex items-center gap-2">
            <Link className="h-5 w-5" />
            Assign Modifiers to {menuItem.name}
          </div>
        </DialogTitle>
        <DialogDescription>
          Choose which modifier groups customers can customize when ordering this item.
        </DialogDescription>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search modifier groups..."
              className="pl-9"
            />
          </div>

          {/* Stats */}
          <div className="text-sm text-muted-foreground">
            {selectedGroupIds.size} of {activeGroups.length} modifier groups selected
          </div>

          {/* Loading/Error States */}
          {modifierGroups.isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading modifier groups...</p>
          )}

          {modifierGroups.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p>Error loading modifier groups: {failureText(modifierGroups.error)}</p>
              <Button 
                className="mt-2" 
                variant="outline" 
                onClick={() => modifierGroups.refetch()}
              >
                Try Again
              </Button>
            </div>
          )}

          {/* Empty States */}
          {!modifierGroups.isLoading && activeGroups.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No active modifier groups found. Create some modifier groups first.
              </p>
            </div>
          )}

          {!modifierGroups.isLoading && activeGroups.length > 0 && filteredGroups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No modifier groups match your search.
            </p>
          )}

          {/* Modifier Groups List */}
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {filteredGroups.map((group) => {
              const isSelected = selectedGroupIds.has(group.id)
              const activeOptionsCount = group.options.filter(opt => opt.isActive).length
              
              return (
                <div
                  key={group.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  )}
                  onClick={() => handleToggleGroup(group.id)}
                >
                  <div className={cn(
                    'mt-0.5 flex h-5 w-5 items-center justify-center rounded border-2 transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground'
                  )}>
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{group.name}</h3>
                      {group.isRequired && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                          Required
                        </span>
                      )}
                      {group.isMultipleSelect && (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                          Multi-select
                        </span>
                      )}
                    </div>
                    
                    {group.description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {group.description}
                      </p>
                    )}
                    
                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{activeOptionsCount} active option{activeOptionsCount === 1 ? '' : 's'}</span>
                      <span>Min: {group.minSelections}, Max: {group.maxSelections}</span>
                    </div>
                    
                    {/* Preview some options */}
                    {group.options.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {group.options.slice(0, 3).map((option) => (
                          <span
                            key={option.id}
                            className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                          >
                            {option.name}
                            {option.priceCents !== 0 && (
                              <span className="ml-1">
                                {option.priceCents > 0 ? '+' : ''}
                                ${(option.priceCents / 100).toFixed(2)}
                              </span>
                            )}
                          </span>
                        ))}
                        {group.options.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{group.options.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between border-t pt-4">
          <Button variant="outline" onClick={handleClose} disabled={assignMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={assignMutation.isPending}>
            {assignMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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