import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSearchbar,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, starOutline, star } from 'ionicons/icons';

import { formatBasisPoints, formatPaise, parseCurrencyToPaise, parsePercentToBasisPoints } from '../../../core/money';
import { MastersRepository, type CatalogueItem } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

/**
 * Settings → Item catalogue (§7.3).
 *
 * The catalogue is what makes the editor quick: items with a saved rate, added to a document in one
 * tap. Until this screen existed the seeded items could be used but never added to, edited or
 * repriced, and the editor's "your catalogue is empty" message pointed at a screen that was not
 * there.
 *
 * Items are grouped by category, in the repository's own §7.3 order — favourites, then most used,
 * then alphabetical — so the grouping here is presentational only and the picker in the editor shows
 * the same sequence.
 */
@Component({
  selector: 'app-catalogue',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonSearchbar,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonBadge,
    IonNote,
    IonToggle,
    IonSpinner,
  ],
  templateUrl: './catalogue.page.html',
  styleUrl: './catalogue.page.scss',
})
export class CataloguePage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly items = signal<CatalogueItem[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly includeArchived = signal(false);

  /**
   * Items grouped by category, preserving the order the repository returned them in.
   *
   * Uncategorised items go last under "Other" rather than first under an empty heading — an item
   * with no category is the common case when someone is adding their first few, and pushing them to
   * the top would bury the organised ones.
   */
  readonly groups = computed(() => {
    const byCategory = new Map<string, CatalogueItem[]>();
    for (const item of this.items()) {
      const key = item.category.trim();
      const list = byCategory.get(key) ?? [];
      list.push(item);
      byCategory.set(key, list);
    }
    const named = [...byCategory.entries()]
      .filter(([key]) => key.length > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const uncategorised = byCategory.get('') ?? [];
    return [
      ...named.map(([heading, entries]) => ({ heading, entries })),
      ...(uncategorised.length > 0 ? [{ heading: 'Other', entries: uncategorised }] : []),
    ];
  });

  constructor() {
    addIcons({ addOutline, starOutline, star });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  /** Re-entry: an item's usage count changes as documents are built. */
  async ionViewWillEnter(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(
        await this.masters.listCatalogueItems({
          search: this.search(),
          includeArchived: this.includeArchived(),
        }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async onSearch(value: string | null | undefined): Promise<void> {
    this.search.set(value ?? '');
    await this.reload();
  }

  async onArchivedToggle(checked: boolean): Promise<void> {
    this.includeArchived.set(checked);
    await this.reload();
  }

  rateLabel(item: CatalogueItem): string {
    return item.defaultRate === 0 ? 'No rate set' : `${formatPaise(item.defaultRate)} / ${item.unit}`;
  }

  taxLabel(item: CatalogueItem): string {
    return item.taxRateBp === 0 ? 'No tax' : `${formatBasisPoints(item.taxRateBp)}% tax`;
  }

  async add(): Promise<void> {
    await this.edit(this.masters.emptyCatalogueItem(), 'New item');
  }

  /**
   * Add or edit through one alert.
   *
   * A form in a dialogue rather than a page of its own: a catalogue item is six short fields, and a
   * full screen for it would be two navigations for what is a small correction most of the time.
   */
  async edit(item: CatalogueItem, header = 'Edit item'): Promise<void> {
    const alert = await this.alerts.create({
      header,
      inputs: [
        { name: 'name', type: 'text', value: item.name, placeholder: 'Item or service name' },
        { name: 'rate', type: 'text', value: item.defaultRate === 0 ? '' : formatPaise(item.defaultRate), placeholder: 'Rate', attributes: { inputmode: 'decimal' } },
        { name: 'unit', type: 'text', value: item.unit, placeholder: 'Unit (nos, sqft, hour)' },
        { name: 'taxRate', type: 'text', value: formatBasisPoints(item.taxRateBp), placeholder: 'Tax %', attributes: { inputmode: 'decimal' } },
        { name: 'hsnSac', type: 'text', value: item.hsnSac ?? '', placeholder: 'HSN / SAC (optional)' },
        { name: 'category', type: 'text', value: item.category, placeholder: 'Category (optional)' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values: Record<string, string>) => {
            void this.save(item, values);
          },
        },
      ],
    });
    await alert.present();
  }

  private async save(item: CatalogueItem, values: Record<string, string>): Promise<void> {
    const name = (values['name'] ?? '').trim();
    if (name.length === 0) {
      this.toast.show('An item needs a name.');
      return;
    }
    // §16.5: the rate and the tax rate go through the shared parsers, so "1,250.50" and "18%" mean
    // the same here as they do in the document editor.
    const rate = parseCurrencyToPaise(values['rate'] ?? '') ?? 0;
    const taxRateBp = parsePercentToBasisPoints(values['taxRate'] ?? '') ?? 0;
    const hsnSac = (values['hsnSac'] ?? '').trim();

    try {
      await this.masters.saveCatalogueItem({
        ...item,
        name,
        defaultRate: rate,
        unit: (values['unit'] ?? '').trim() || 'nos',
        taxRateBp,
        hsnSac: hsnSac.length > 0 ? hsnSac : null,
        category: (values['category'] ?? '').trim(),
      });
      await this.reload();
      this.toast.show('Saved.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  async toggleFavourite(item: CatalogueItem): Promise<void> {
    try {
      await this.masters.toggleCatalogueFavourite(item.id);
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /**
   * Remove an item, or archive it if a document already uses it.
   *
   * Same rule as clients (§5.2): the repository decides, because only it knows whether anything
   * references the item. The message therefore explains the rule instead of promising an outcome.
   */
  async remove(item: CatalogueItem): Promise<void> {
    const alert = await this.alerts.create({
      header: `Remove ${item.name}?`,
      message:
        'If a document already uses it, it is archived instead — hidden from the picker, with those ' +
        'documents left exactly as they are.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.confirmRemove(item);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(item: CatalogueItem): Promise<void> {
    try {
      const outcome = await this.masters.deleteOrArchiveCatalogueItem(item.id);
      await this.reload();
      this.toast.show(outcome === 'archived' ? 'Archived — documents using it are untouched.' : 'Removed.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
