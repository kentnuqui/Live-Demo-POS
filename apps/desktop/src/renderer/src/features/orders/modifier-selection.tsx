import { useCallback, useMemo, useState, useRef, useReducer } from 'react'
import { formatMoney, type ModifierGroupDto } from '@towns/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModifierSelectionProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (selections: Array<{ modifierGroupId: string; modifierOptionId: string }>) => void
  modifierGroups: ModifierGroupDto[]
  currency: string
  itemName: string
}

type SelectionAction = 
  | { type: 'TOGGLE_OPTION'; groupId: string; optionId: string; group: ModifierGroupDto }
  | { type: 'CLEAR' }

function selectionReducer(
  state: Map<string, Set<string>>, 
  action: SelectionAction
): Map<string, Set<string>> {
  switch (action.type) {
    case 'TOGGLE_OPTION': {
      const { groupId, optionId, group } = action
      const newState = new Map(state)
      const groupSelections = new Set(newState.get(groupId) || [])
      
      if (group.isMultipleSelect) {
        if (groupSelections.has(optionId)) {
          groupSelections.delete(optionId)
        } else {
          if (groupSelections.size < group.maxSelections) {
            groupSelections.add(optionId)
          } else {
            return state // No change
          }
        }
      } else {
        if (groupSelections.has(optionId)) {
          groupSelections.clear()
        } else {
          groupSelections.clear()
          groupSelections.add(optionId)
        }
      }
      
      if (groupSelections.size === 0) {
        newState.delete(groupId)
      } else {
        newState.set(groupId, groupSelections)
      }
      
      return newState
    }
    case 'CLEAR':
      return new Map()
    default:
      return state
  }
}

export function ModifierSelectionDialog({
  isOpen,
  onClose,
  onConfirm,
  modifierGroups,
  currency,
  itemName
}: ModifierSelectionProps) {
  const [selections, dispatchSelection] = useReducer(selectionReducer, new Map<string, Set<string>>())
  const [validationErrors, setValidationErrors] = useState<Map<string, string>>(new Map())
  const lastToggleRef = useRef<{ groupId: string; optionId: string; timestamp: number } | null>(null)

  // Calculate total modifier price (optimized with lookup maps)
  const modifierTotal = useMemo(() => {
    const optionMap = new Map()
    
    // Build option lookup map for O(1) access
    for (const group of modifierGroups) {
      for (const option of group.options) {
        optionMap.set(option.id, option)
      }
    }
    
    let total = 0
    for (const [, optionIds] of selections.entries()) {
      for (const optionId of optionIds) {
        const option = optionMap.get(optionId)
        if (option) total += option.priceCents
      }
    }
    return total
  }, [selections, modifierGroups])

  const handleOptionToggle = useCallback((groupId: string, optionId: string) => {
    const now = Date.now()
    const lastToggle = lastToggleRef.current
    
    // Prevent duplicate calls within 200ms
    if (lastToggle && 
        lastToggle.groupId === groupId && 
        lastToggle.optionId === optionId && 
        (now - lastToggle.timestamp) < 200) {
      return
    }
    
    lastToggleRef.current = { groupId, optionId, timestamp: now }
    
    const group = modifierGroups.find(g => g.id === groupId)
    if (!group) return

    dispatchSelection({ type: 'TOGGLE_OPTION', groupId, optionId, group })

    // Clear validation error for this group
    setValidationErrors(prev => {
      const newErrors = new Map(prev)
      newErrors.delete(groupId)
      return newErrors
    })
  }, [modifierGroups])

  const validateSelections = () => {
    const errors = new Map<string, string>()
    
    for (const group of modifierGroups) {
      const groupSelections = selections.get(group.id) || new Set()
      const selectionCount = groupSelections.size
      
      if (group.isRequired && selectionCount < group.minSelections) {
        errors.set(group.id, `Required: Select at least ${group.minSelections} option${group.minSelections === 1 ? '' : 's'}`)
      } else if (selectionCount > group.maxSelections) {
        errors.set(group.id, `Too many: Maximum ${group.maxSelections} option${group.maxSelections === 1 ? '' : 's'} allowed`)
      } else if (selectionCount < group.minSelections && selectionCount > 0) {
        errors.set(group.id, `Select at least ${group.minSelections} option${group.minSelections === 1 ? '' : 's'}`)
      }
    }
    
    setValidationErrors(errors)
    return errors.size === 0
  }

  const handleConfirm = () => {
    if (!validateSelections()) return

    const selectedModifiers: Array<{ modifierGroupId: string; modifierOptionId: string }> = []
    
    for (const [groupId, optionIds] of selections.entries()) {
      for (const optionId of optionIds) {
        selectedModifiers.push({ modifierGroupId: groupId, modifierOptionId: optionId })
      }
    }
    
    onConfirm(selectedModifiers)
    onClose()
  }

  const handleClose = () => {
    dispatchSelection({ type: 'CLEAR' })
    setValidationErrors(new Map())
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Customize {itemName}</DialogTitle>
        <DialogDescription>
          Choose your preferences for this item.
        </DialogDescription>
        
        <div className="space-y-6">
          {modifierGroups.map(group => {
            const groupSelections = selections.get(group.id) || new Set()
            const error = validationErrors.get(group.id)
            
            return (
              <div key={group.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-serif text-lg leading-tight">
                      {group.name}
                      {group.isRequired && <span className="ml-1 text-red-500">*</span>}
                    </h3>
                    {group.description && (
                      <p className="text-sm text-muted-foreground">{group.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {group.isMultipleSelect ? (
                      <>
                        {groupSelections.size} of {group.maxSelections} selected
                        {groupSelections.size >= group.maxSelections && (
                          <div className="text-orange-600 font-medium">Maximum reached</div>
                        )}
                      </>
                    ) : (
                      <>Choose one</>
                    )}
                  </div>
                </div>
                
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
                
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.options.map(option => {
                    const isSelected = groupSelections.has(option.id)
                    const canSelect = group.isMultipleSelect 
                      ? groupSelections.size < group.maxSelections || isSelected
                      : true
                    
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={!canSelect && !isSelected}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleOptionToggle(group.id, option.id)
                        }}
                        className={cn(
                          'flex items-center justify-between rounded-lg border p-3 text-left transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border hover:bg-muted',
                          !canSelect && !isSelected && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <div>
                          <span className="font-serif text-lg leading-tight">{option.name}</span>
                          {option.description && (
                            <div className="text-sm text-muted-foreground">
                              {option.description}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          {option.priceCents > 0 && (
                            <span className="num font-serif text-lg">+{formatMoney(option.priceCents, currency)}</span>
                          )}
                          {option.priceCents < 0 && (
                            <span className="num font-serif text-lg text-green-600">
                              {formatMoney(option.priceCents, currency)}
                            </span>
                          )}
                          {isSelected && (
                            <div className="mt-1 h-2 w-2 rounded-full bg-primary"></div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        
        <div className="flex items-center justify-between border-t pt-4">
          <div className="num font-serif text-lg">
            {modifierTotal > 0 && (
              <>Modifier total: +{formatMoney(modifierTotal, currency)}</>
            )}
            {modifierTotal < 0 && (
              <>Modifier total: {formatMoney(modifierTotal, currency)}</>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm}>
              Add to Order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}