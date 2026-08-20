import { Component, computed, input, output } from '@angular/core';
import { IonInput, IonItem, IonList, IonNote } from '@ionic/angular';

import type { CustomFieldValue } from '../../../core/types';
import type { CustomFieldDef } from '../../../data/repositories/masters.repository';

/**
 * Entry for the extra fields the owner declared (§7.7).
 *
 * ## Why this is a shared component
 *
 * The same three things have to happen on a document, on a client and on the business profile:
 * show one input per *definition*, keep the values that already exist, and drop nothing when a
 * definition is later removed. Writing that three times would guarantee the three drift — and the
 * drift would be invisible, because a field that silently fails to save looks identical to a field
 * nobody filled in.
 *
 * ## Why values are stored by label
 *
 * `CustomFieldValue` is `{ label, value }` rather than `{ defId, value }`. That is the existing
 * schema and it is the right one for this app: the values live inside a document's JSON, and a
 * document must keep saying what it said even after the definition behind it is deleted or renamed
 * (§5.4). The cost is that renaming a definition orphans old values, which is why removing a
 * definition warns that existing records keep theirs.
 *
 * Values with no matching definition are therefore *preserved but not shown* — dropping them would
 * quietly rewrite an issued document the first time someone opened it.
 */
@Component({
  selector: 'cd-custom-field-values',
  standalone: true,
  imports: [IonList, IonItem, IonInput, IonNote],
  templateUrl: './custom-field-values.component.html',
  styleUrl: './custom-field-values.component.scss',
})
export class CustomFieldValuesComponent {
  /** The definitions in scope, from `MastersRepository.listCustomFieldDefs`. */
  readonly definitions = input.required<readonly CustomFieldDef[]>();

  /** The values currently stored on the record. */
  readonly values = input.required<readonly CustomFieldValue[]>();

  /** Emitted with the complete new list whenever one field changes. */
  readonly changed = output<CustomFieldValue[]>();

  /** One row per definition, carrying whatever value is already stored under that label. */
  readonly rows = computed(() =>
    this.definitions().map((def) => ({
      def,
      value: this.values().find((v) => v.label === def.label)?.value ?? '',
    })),
  );

  /**
   * Values whose definition no longer exists.
   *
   * Kept and passed through untouched. They are not shown as editable, because there is no
   * definition to say what they are or how to type them, but discarding them would rewrite history.
   */
  private orphans(): CustomFieldValue[] {
    const known = new Set(this.definitions().map((def) => def.label));
    return this.values().filter((value) => !known.has(value.label));
  }

  /** The input type for a definition — `date` and `number` get the right keyboard. */
  inputType(def: CustomFieldDef): 'text' | 'number' | 'date' {
    return def.fieldType;
  }

  onValue(def: CustomFieldDef, raw: string): void {
    const trimmed = raw.trim();
    const others = this.rows()
      .filter((row) => row.def.label !== def.label)
      .filter((row) => row.value.trim().length > 0)
      .map((row) => ({ label: row.def.label, value: row.value }));

    const next = [...others];
    // A blank field is an absent value, not an empty one: an empty label/value pair would print an
    // empty row on the document.
    if (trimmed.length > 0) next.push({ label: def.label, value: trimmed });

    // Order follows the definitions so the document prints them in the order they were declared.
    const order = new Map(this.definitions().map((d, index) => [d.label, index]));
    next.sort((a, b) => (order.get(a.label) ?? 0) - (order.get(b.label) ?? 0));

    this.changed.emit([...next, ...this.orphans()]);
  }
}
