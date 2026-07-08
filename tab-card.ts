import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Shape of the card's YAML configuration. Every array below is "per tab",
 * i.e. index 0 belongs to the first card, index 1 to the second, and so on.
 */
interface TabCardConfig {
  type?: string;
  cards?: any[];              // the child cards shown inside the tabs
  tabs?: string[];           // the tab labels
  tab_icons?: string[];      // optional icon per tab
  tab_hold_actions?: any[];  // action fired when a tab is long-pressed
  tab_outside?: boolean[];   // render this tab's card outside the tab bar?
  outside_cards?: boolean;   // default for tab_outside when a tab has none
}

/**
 * MAIN CARD
 */
@customElement('custom-tab-card')
export class CustomTabCard extends LitElement {
  @property({ attribute: false }) public hass!: any;
  @state() private _config!: TabCardConfig;
  @state() private _activeTab: number = 0;
  @state() private _cardElements: any[] = [];
  
  // Keep in sync with the CSS fill duration (HOLD_DURATION - HOLD_ANIM_DELAY).
  private static readonly HOLD_DURATION = 500;
  private static readonly HOLD_ANIM_DELAY = 300;

  private _holdTimer?: ReturnType<typeof setTimeout>;
  private _isHolding: boolean = false;
  @state() private _pressingTab?: number;
  private _pressingTimer?: ReturnType<typeof setTimeout>;
  
  @state() private _activeCardHidden: boolean = true;

  private _resizeObserver?: ResizeObserver;
  private _observedContainer?: HTMLElement;
  private _cornerFixedEls: Set<any> = new Set();
  private _cardHidden: WeakMap<any, boolean> = new WeakMap();

  public async setConfig(config: any): Promise<void> {
    this._config = config;
    await this._createCards();
  }

  private async _createCards() {
    const helpers = await (window as any).loadCardHelpers();
    if (helpers && this._config.cards) {
      this._cardElements = this._config.cards.map((cardConfig: any) => {
        const element = helpers.createCardElement(cardConfig);
        element.hass = this.hass;
        return element;
      });
    }
  }

  /**
   * Should the card in the given tab be rendered "outside" the tab bar?
   * A per-tab setting always wins; otherwise we fall back to the card-wide
   * default. This is the single source of truth used everywhere.
   */
  private _isOutside(index: number): boolean {
    const perTab = this._config.tab_outside?.[index];
    return perTab !== undefined ? perTab : this._config.outside_cards === true;
  }

  protected updated(changedProps: Map<string, any>) {
    super.updated(changedProps);
    if (changedProps.has('hass') && this._cardElements.length > 0) {
      this._cardElements.forEach((card) => {
        card.hass = this.hass;
      });
    }

    // Collapses the tab when the active card renders empty content.
    this._ensureResizeObserver();

    // Only depends on cards/outside-config, so skip on frequent hass ticks.
    if (changedProps.has('_config') || changedProps.has('_cardElements')) {
      setTimeout(() => {
        this._cardElements.forEach((card, index) => {
          injectCornerFix(card, this._isOutside(index), this._cornerFixedEls);
        });
      }, 0);
    }
  }

  private _ensureResizeObserver() {
    const container = this.shadowRoot?.querySelector('#card-container') as HTMLElement;
    if (!container || this._observedContainer === container) return;

    this._resizeObserver?.disconnect();
    this._resizeObserver = new ResizeObserver(() => {
      // Measure the card itself, not the container - the container's padding
      // would otherwise never report 0 for an empty card.
      const visible = this._cardElements.find((c) => c && c.style.display !== 'none');
      const isHidden = !visible || visible.offsetHeight === 0;
      if (visible) this._cardHidden.set(visible, isHidden);
      if (this._activeCardHidden !== isHidden) {
        this._activeCardHidden = isHidden;
      }
    });
    this._resizeObserver.observe(container);
    this._observedContainer = container;
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._endHold();

    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._observedContainer = undefined;

    // Reset the corner-fix guards so they re-attach if reconnected.
    this._cornerFixedEls.forEach((el) => {
      el._tabFixObserver?.disconnect();
      el._tabFixObserver = undefined;
      el._tabFixOutside = undefined;
    });
    this._cornerFixedEls.clear();
  }

  public static getConfigElement() {
    return document.createElement('custom-tab-card-editor');
  }

  public static getStubConfig() {
    return {
      type: 'custom:custom-tab-card',
      cards: [
        {
          type: 'picture',
          image: 'https://demo.home-assistant.io/stub_config/t-shirt-promo.png'
        },
        {
          type: 'picture',
          image: 'https://demo.home-assistant.io/stub_config/t-shirt-promo.png'
        }
      ],
      tabs: ['Tab 1', 'Tab 2'],
      tab_outside: [true, true],
      tab_hold_actions: [{ action: 'none' }, { action: 'none' }],
      tab_icons: ['', '']
    };
  }

  private _startHold(index: number) {
    this._isHolding = false;

    // Delayed so a quick click never flashes the fill animation.
    this._pressingTimer = setTimeout(() => {
      this._pressingTab = index;
    }, CustomTabCard.HOLD_ANIM_DELAY);

    this._holdTimer = setTimeout(() => {
      this._isHolding = true;
      this._triggerHoldAction(index);
    }, CustomTabCard.HOLD_DURATION);
  }

  private _endHold() {
    this._pressingTab = undefined;
    if (this._pressingTimer) {
      clearTimeout(this._pressingTimer);
      this._pressingTimer = undefined;
    }
    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      this._holdTimer = undefined;
    }
  }

  private _selectTab(index: number) {
    this._activeTab = index;
    // Apply the card's last-known collapse state synchronously to avoid a
    // one-frame flash; the ResizeObserver corrects it if it was wrong.
    const target = this._cardElements[index];
    this._activeCardHidden = target ? (this._cardHidden.get(target) ?? true) : true;
  }

  private _onTabKeydown(e: KeyboardEvent, index: number, count: number) {
    let newIndex = index;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        newIndex = (index + 1) % count;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        newIndex = (index - 1 + count) % count;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'End':
        newIndex = count - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this._selectTab(index);
        return;
      default:
        return;
    }
    e.preventDefault();
    this._selectTab(newIndex);
    const tabEls = this.shadowRoot?.querySelectorAll<HTMLElement>('.tab');
    tabEls?.[newIndex]?.focus();
  }

  private _triggerHoldAction(index: number) {
    const actionConfig = this._config.tab_hold_actions?.[index];
    if (!actionConfig || actionConfig.action === 'none') return;

    this.dispatchEvent(new CustomEvent('haptic', { detail: 'heavy', bubbles: true, composed: true }));
    this.dispatchEvent(new CustomEvent('hass-action', {
      bubbles: true, composed: true,
      detail: { config: { hold_action: actionConfig }, action: 'hold' }
    }));
  }

  protected render(): TemplateResult {
    if (!this._config || !this.hass) return html``;
    const tabs = this._config.tabs || (this._config.cards ? this._config.cards.map((_: any, i: number) => `Tab ${i + 1}`) : []);
    const icons = this._config.tab_icons || [];
    
    // Ensure active tab stays in bounds if a card was just deleted
    const activeIndex = Math.min(this._activeTab, Math.max(0, this._cardElements.length - 1));

    const isOutside = this._isOutside(activeIndex);

    const isOutsideAndVisible = isOutside && !this._activeCardHidden;
    const isIsolated = isOutside && this._activeCardHidden;
    // Inside mode: collapse the empty content area so the card shrinks to just
    // the tab header when the active card renders nothing.
    const isInsideCollapsed = !isOutside && this._activeCardHidden;

    const tabsHtml = html`
      <div class="tabs-header ${isOutsideAndVisible ? 'outside' : ''} ${isIsolated ? 'isolated' : ''} ${isInsideCollapsed ? 'inside-collapsed' : ''}" role="tablist">
        ${tabs.map((tab: string, index: number) => html`
          <div class="tab ${activeIndex === index ? 'active' : ''} ${this._pressingTab === index ? 'pressing' : ''}"
               role="tab"
               aria-selected=${activeIndex === index ? 'true' : 'false'}
               tabindex=${activeIndex === index ? 0 : -1}
               @pointerdown=${() => this._startHold(index)}
               @pointerup=${() => this._endHold()}
               @pointerleave=${() => this._endHold()}
               @pointercancel=${() => this._endHold()}
               @contextmenu=${(e: Event) => e.preventDefault()}
               @keydown=${(e: KeyboardEvent) => this._onTabKeydown(e, index, tabs.length)}
               @click=${() => {
                 if (this._isHolding) {
                   this._isHolding = false;
                   return;
                 }
                 this._selectTab(index);
               }}>
            ${icons[index] ? html`<ha-icon class="tab-icon" .icon=${icons[index]}></ha-icon>` : ''}
            <span class="tab-text">${tab}</span>
          </div>
        `)}
      </div>
    `;

    if (isOutside) {
      return html`
        <ha-card class="${isOutsideAndVisible ? 'outside-tabs-card' : ''}">${tabsHtml}</ha-card>
        <div id="card-container" class="outside-card-content">
          ${this._renderCardList(activeIndex)}
        </div>
      `;
    }

    return html`
      <ha-card>
        ${tabsHtml}
        <div id="card-container" class="card-content ${isInsideCollapsed ? 'collapsed' : ''}">
          ${this._renderCardList(activeIndex)}
        </div>
      </ha-card>
    `;
  }

  /**
   * Returns all child cards, showing only the active one and hiding the rest.
   * (Toggling `display` here keeps every card mounted so switching tabs is
   * instant and each card keeps its state.)
   */
  private _renderCardList(activeIndex: number) {
    return this._cardElements.map((card, index) => {
      if (card) card.style.display = index === activeIndex ? '' : 'none';
      return card;
    });
  }

  static styles = css`
    :host {
      --tab-radius: var(--ha-card-border-radius, 12px);
    }

    .tabs-header { 
      display: flex; 
      justify-content: center; 
      background: var(--secondary-background-color); 
      border-bottom: 1px solid var(--divider-color); 
      overflow-x: auto;
      border-top-left-radius: var(--ha-card-border-radius, 12px);
      border-top-right-radius: var(--ha-card-border-radius, 12px);
    }
    .tabs-header.outside {
      border-bottom: none;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }
    .tabs-header.isolated {
      border-bottom: none;
      border-bottom-left-radius: var(--ha-card-border-radius, 12px);
      border-bottom-right-radius: var(--ha-card-border-radius, 12px);
    }
    .tabs-header.inside-collapsed {
      border-bottom: none;
      border-bottom-left-radius: var(--ha-card-border-radius, 12px);
      border-bottom-right-radius: var(--ha-card-border-radius, 12px);
    }
    /* ha-card's own transition otherwise animates the border-radius on tab
       switches, making the corners visibly slide/overlap. */
    ha-card {
      transition: none !important;
    }
    ha-card.outside-tabs-card {
      border-bottom-left-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
      border-bottom: none !important;
    }
    .tab { 
      flex: 1; 
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-align: center; 
      padding: 12px 20px; 
      cursor: pointer; 
      color: var(--secondary-text-color); 
      border-bottom: 3px solid transparent; 
      white-space: nowrap; 
      font-weight: 500; 
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      position: relative;
      overflow: hidden;
      transition: background-color 0.2s ease;
    }
    .tab::after {
      content: '';
      position: absolute;
      inset: 0;
      background: currentColor;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    @media (hover: hover) {
      .tab:hover::after {
        opacity: 0.1;
      }
    }
    .tab:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
    }
    .tab::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background-color: var(--primary-color);
      opacity: 0.2;
      pointer-events: none;
      transition: width 0s; /* instantly resets when released */
    }
    .tab.pressing::before {
      width: 100%;
      transition: width 0.2s linear; /* HOLD_DURATION (500ms) - HOLD_ANIM_DELAY (300ms) */
    }
    .tab.active { color: var(--primary-color); border-bottom-color: var(--primary-color); background: var(--card-background-color); }
    .card-content { padding: 8px; }
    /* Drop padding for an empty active card so the ha-card shrinks to the header. */
    .card-content.collapsed { padding: 0; }
    .outside-card-content { margin-top: 0; }
    .outside-card-content > * {
      --ha-card-border-radius: 0 0 var(--tab-radius) var(--tab-radius);
    }
    .outside-card-content > * * {
      --ha-card-border-radius: var(--tab-radius);
    }
  `;
}

/**
 * EDITOR
 */
@customElement('custom-tab-card-editor')
export class CustomTabCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: any;
  @property({ attribute: false }) public lovelace?: any;

  @state() private _config!: TabCardConfig;
  private _subEditor?: any;

  private _sanitizeConfig(config: TabCardConfig) {
    return {
      type: 'vertical-stack',
      cards: config.cards || []
    };
  }

  /**
   * Maps each card in the new list to its old index, so per-tab settings
   * (name, icon, ...) travel with it. -1 means the card is new.
   */
  private _findOldIndexes(updatedCards: any[]): number[] {
    const oldCards = [...(this._config.cards || [])];
    const sameLength = updatedCards.length === (this._config.cards?.length || 0);

    return updatedCards.map((card: any, i: number) => {
      const oldIndex = oldCards.indexOf(card);
      if (oldIndex !== -1) {
        oldCards[oldIndex] = null; // don't match the same old card twice
        return oldIndex;
      }
      // Not found; if length is unchanged it was likely edited in place.
      return sameLength ? i : -1;
    });
  }

  public async setConfig(config: any) {
    this._config = config;
    if (this._subEditor) {
      this._subEditor.setConfig(this._sanitizeConfig(config));
    }
  }

  protected async firstUpdated() {
    try {
      const helpers = await (window as any).loadCardHelpers();
      
      const stack = await helpers.createCardElement({ type: 'vertical-stack', cards: [] });
      this._subEditor = await stack.constructor.getConfigElement();
      
      this._subEditor.hass = this.hass;
      this._subEditor.lovelace = this.lovelace; 
      
      this._subEditor.setConfig(this._sanitizeConfig(this._config));
      
      this._subEditor.addEventListener('config-changed', (ev: any) => {
        ev.stopPropagation();
        const updatedCards = ev.detail.config.cards || [];

        const oldIndexes = this._findOldIndexes(updatedCards);

        // Reads the old value that belonged to the card now at position `i`.
        const oldValue = (arr: any[], i: number) => (oldIndexes[i] >= 0 ? arr[oldIndexes[i]] : undefined);

        const oldTabs = this._config.tabs || [];
        const oldHoldActions = this._config.tab_hold_actions || [];
        const oldIcons = this._config.tab_icons || [];
        const oldOutside = this._config.tab_outside || [];
        const outsideDefault = this._config.outside_cards === true;

        const newTabs = updatedCards.map((_: any, i: number) => oldValue(oldTabs, i) || `Tab ${i + 1}`);
        const newHoldActions = updatedCards.map((_: any, i: number) => oldValue(oldHoldActions, i) || { action: 'none' });
        const newIcons = updatedCards.map((_: any, i: number) => oldValue(oldIcons, i) || '');
        const newOutside = updatedCards.map((_: any, i: number) => {
          const value = oldValue(oldOutside, i);
          // `false` is a valid choice here, so only fall back when truly unset.
          return value !== undefined ? value : outsideDefault;
        });

        this._dispatchEvent({ ...this._config, cards: updatedCards, tabs: newTabs, tab_hold_actions: newHoldActions, tab_icons: newIcons, tab_outside: newOutside });
      });

      const container = this.shadowRoot?.querySelector('#editor-container');
      if (container) {
        // Briefly hide the container to prevent any 1-frame flash
        (container as HTMLElement).style.visibility = 'hidden';
        container.appendChild(this._subEditor);

        // Wait for LitElement to generate the shadow DOM
        if (this._subEditor.updateComplete) {
          await this._subEditor.updateComplete;
        }
        
        // Persists across Lit updates, hiding ha-form even if HA delays it.
        const style = document.createElement('style');
        style.textContent = `
          ha-form { display: none !important; }
          ha-textfield { display: none !important; }
        `;
        this._subEditor.shadowRoot?.appendChild(style);

        // Reveal the editor
        (container as HTMLElement).style.visibility = '';
      }

    } catch (err) {
      console.error("Failed to load sub-editor:", err);
    }
  }

  protected updated(changedProps: Map<string, any>) {
    super.updated(changedProps);
    
    if (this._subEditor) {
      if (changedProps.has('hass')) {
        this._subEditor.hass = this.hass;
      }
      if (changedProps.has('lovelace')) {
        this._subEditor.lovelace = this.lovelace;
      }
      // Ensure sub-editor remains in the DOM after Lit re-renders the container
      const container = this.shadowRoot?.querySelector('#editor-container');
      if (container && !container.contains(this._subEditor)) {
        container.appendChild(this._subEditor);
      }
    }
  }

  protected render(): TemplateResult {
    const cards = this._config?.cards || [];
    const tabs = this._config?.tabs || [];
    const holdActions = this._config?.tab_hold_actions || [];
    const icons = this._config?.tab_icons || [];
    const outside = this._config?.tab_outside || [];

    return html`
      <div class="card-config">
        <h3>Tab Configuration</h3>

        ${cards.length === 0
          ? html`<p class="hint">Add some cards below to configure their tab names.</p>`
          : cards.map((_: any, index: number) => html`
              <div class="tab-block">
                <ha-textfield
                  class="field"
                  label="Name for Tab ${index + 1}"
                  .value=${tabs[index] || `Tab ${index + 1}`}
                  .index=${index}
                  @input=${this._handleSingleTabChange}
                ></ha-textfield>

                <ha-icon-picker
                  class="field"
                  label="Icon for Tab ${index + 1}"
                  .value=${icons[index] || ''}
                  .index=${index}
                  @value-changed=${this._handleSingleIconChange}
                ></ha-icon-picker>

                <ha-formfield class="field" label="Cards Outside">
                  <ha-switch
                    .checked=${outside[index] ?? (this._config.outside_cards === true)}
                    @change=${(ev: any) => this._handleSingleOutsideChange(ev, index)}
                  ></ha-switch>
                </ha-formfield>

                <ha-selector
                  .hass=${this.hass}
                  .selector=${{ ui_action: {} }}
                  .value=${holdActions[index] || { action: 'none' }}
                  .label=${`Hold Action`}
                  @value-changed=${(ev: any) => this._handleHoldActionChange(ev, index)}
                ></ha-selector>
              </div>
            `)
        }

        <hr class="divider">

        <div id="editor-container"></div>
      </div>
    `;
  }

  static styles = css`
    h3 { margin-top: 0; }
    .hint { color: var(--secondary-text-color); }
    .tab-block {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    /* Shared spacing for the text field, icon picker and "Cards Outside" row. */
    .field {
      display: block;
      width: 100%;
      margin-bottom: 12px;
    }
    .divider {
      border: 0;
      border-bottom: 1px solid var(--divider-color);
      margin: 20px 0;
    }
  `;

  private _handleSingleTabChange(ev: any): void {
    const index = ev.target.index;
    const value = ev.target.value;
    const tabs = [...(this._config.tabs || [])];
    tabs[index] = value;
    this._dispatchEvent({ ...this._config, tabs });
  }

  private _handleSingleIconChange(ev: any): void {
    const index = ev.target.index;
    const value = ev.detail.value;
    const tab_icons = [...(this._config.tab_icons || [])];
    tab_icons[index] = value;
    this._dispatchEvent({ ...this._config, tab_icons });
  }
  
  private _handleHoldActionChange(ev: any, index: number): void {
    const tab_hold_actions = [...(this._config.tab_hold_actions || [])];
    tab_hold_actions[index] = ev.detail.value;
    this._dispatchEvent({ ...this._config, tab_hold_actions });
  }

  private _handleSingleOutsideChange(ev: any, index: number): void {
    const tab_outside = [...(this._config.tab_outside || [])];
    if (tab_outside.length === 0 && this._config.cards) {
      for (let i = 0; i < this._config.cards.length; i++) {
        tab_outside[i] = this._config.outside_cards === true;
      }
    }
    tab_outside[index] = ev.target.checked;
    this._dispatchEvent({ ...this._config, tab_outside });
  }

  private _dispatchEvent(config: any): void {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }
}

// Register the card in the Add Card window
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'custom-tab-card',
  name: 'TabCard',
  preview: true,
  description: 'A custom card that renders a vertical stack as tabs.'
});

/**
 * Pierces nested shadow DOMs to flatten the top corners of nested cards.
 */
const injectCornerFix = async (targetEl: any, isOutside: boolean, registry?: Set<any>) => {
  if (!targetEl) return;

  // Already processed; the MutationObserver below keeps new children in sync.
  if (targetEl._tabFixObserver && targetEl._tabFixOutside === isOutside) return;

  if (targetEl.updateComplete) {
    await targetEl.updateComplete;
  }

  if (targetEl.shadowRoot) {
    let styleEl = targetEl.shadowRoot.querySelector('#tab-card-fix');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'tab-card-fix';
      targetEl.shadowRoot.appendChild(styleEl);
    }
    
    if (isOutside) {
      styleEl.textContent = `
        * {
          --ha-card-border-radius: var(--tab-radius, 12px);
        }
        ha-card {
          border-top-left-radius: 0 !important;
          border-top-right-radius: 0 !important;
        }
        :host(hui-vertical-stack-card) #root > *:first-child {
          --ha-card-border-radius: 0 0 var(--tab-radius, 12px) var(--tab-radius, 12px);
        }
        :host(hui-horizontal-stack-card) #root > * {
          --ha-card-border-radius: 0 0 var(--tab-radius, 12px) var(--tab-radius, 12px);
        }
      `;
    } else {
      styleEl.textContent = '';
    }

    // Recursively find all nested custom elements and fix them too
    targetEl.shadowRoot.querySelectorAll('*').forEach((child: any) => {
      if (child.tagName && child.tagName.includes('-') && child.tagName !== 'HA-CARD') {
        injectCornerFix(child, isOutside, registry);
      }
    });

    // Catches elements added later; reads the live _tabFixOutside value.
    if (!targetEl._tabFixObserver) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(m => {
          m.addedNodes.forEach((node: any) => {
            if (node.tagName && node.tagName.includes('-') && node.tagName !== 'HA-CARD') {
              injectCornerFix(node, targetEl._tabFixOutside, registry);
            } else if (node.querySelectorAll) {
              node.querySelectorAll('*').forEach((child: any) => {
                if (child.tagName && child.tagName.includes('-') && child.tagName !== 'HA-CARD') {
                  injectCornerFix(child, targetEl._tabFixOutside, registry);
                }
              });
            }
          });
        });
      });
      observer.observe(targetEl.shadowRoot, { childList: true, subtree: true });
      targetEl._tabFixObserver = observer;
      registry?.add(targetEl);
    }
  }

  // Check Light DOM as well for elements wrapped without shadow DOM
  if (targetEl.children) {
    Array.from(targetEl.children).forEach((child: any) => {
      if (child.tagName && child.tagName.includes('-') && child.tagName !== 'HA-CARD') {
        injectCornerFix(child, isOutside, registry);
      }
    });
  }

  // Lets the guard above short-circuit and the observer track isOutside.
  targetEl._tabFixOutside = isOutside;
};