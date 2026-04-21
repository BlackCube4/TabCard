import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * MAIN CARD
 */
@customElement('custom-tab-card')
export class CustomTabCard extends LitElement {
  @property({ attribute: false }) public hass!: any;
  @state() private _config!: any;
  @state() private _activeTab: number = 0;
  @state() private _cardElements: any[] = [];
  
  private _holdTimer?: ReturnType<typeof setTimeout>;
  private _isHolding: boolean = false;
  @state() private _pressingTab?: number;
  private _pressingTimer?: ReturnType<typeof setTimeout>;
  
  @state() private _activeCardHidden: boolean = false;

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

  protected updated(changedProps: Map<string, any>) {
    super.updated(changedProps);
    if (changedProps.has('hass') && this._cardElements.length > 0) {
      this._cardElements.forEach((card) => {
        card.hass = this.hass;
      });
    }

    // Let the child cards finish their own updates, then just check the height.
    setTimeout(() => {
      const container = this.shadowRoot?.querySelector('#card-container') as HTMLElement;
      if (container) {
        const isHidden = container.offsetHeight === 0;
        if (this._activeCardHidden !== isHidden) {
          this._activeCardHidden = isHidden;
        }
      }
    }, 0);
  }

  public static getConfigElement() {
    return document.createElement('custom-tab-card-editor');
  }

  private _startHold(index: number) {
    this._isHolding = false;
    
    // Delay the visual progress bar by 200ms
    this._pressingTimer = setTimeout(() => {
      this._pressingTab = index;
    }, 200);

    this._holdTimer = setTimeout(() => {
      this._isHolding = true;
      this._triggerHoldAction(index);
    }, 500);
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

    const isOutsideAndVisible = this._config.outside_cards && !this._activeCardHidden;
    const isIsolated = this._config.outside_cards && this._activeCardHidden;

    const tabsHtml = html`
      <div class="tabs-header ${isOutsideAndVisible ? 'outside' : ''} ${isIsolated ? 'isolated' : ''}">
        ${tabs.map((tab: string, index: number) => html`
          <div class="tab ${activeIndex === index ? 'active' : ''} ${this._pressingTab === index ? 'pressing' : ''}" 
               @pointerdown=${() => this._startHold(index)}
               @pointerup=${() => this._endHold()}
               @pointerleave=${() => this._endHold()}
               @pointercancel=${() => this._endHold()}
               @contextmenu=${(e: Event) => e.preventDefault()}
               @click=${() => {
                 if (this._isHolding) {
                   this._isHolding = false;
                   return;
                 }
                 this._activeTab = index;
               }}>
            ${icons[index] ? html`<ha-icon class="tab-icon" .icon=${icons[index]}></ha-icon>` : ''}
            <span class="tab-text">${tab}</span>
          </div>
        `)}
      </div>
    `;

    if (this._config.outside_cards) {
      return html`
        <ha-card class="${isOutsideAndVisible ? 'outside-tabs-card' : ''}">${tabsHtml}</ha-card>
        <div id="card-container" class="outside-card-content">
          ${this._cardElements[activeIndex]}
        </div>
      `;
    }

    return html`
      <ha-card>
        ${tabsHtml}
        <div id="card-container" class="card-content">
          ${this._cardElements[activeIndex]}
        </div>
      </ha-card>
    `;
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
      /* NEW: Match the top corners to the parent card */
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
    .tab:hover::after {
      opacity: 0.1;
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
      transition: width 0.3s linear; /* 500ms total hold - 200ms delay */
    }
    .tab.active { color: var(--primary-color); border-bottom-color: var(--primary-color); background: var(--card-background-color); }
    .card-content { padding: 8px; }
    .outside-card-content { margin-top: 0; }
    .outside-card-content > * {
      --ha-card-border-radius: 0 0 var(--tab-radius) var(--tab-radius);
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
  
  @state() private _config!: any;
  private _subEditor?: any;

  private _sanitizeConfig(config: any) {
    return {
      type: 'vertical-stack',
      cards: config.cards || []
    };
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
        const oldCards = [...(this._config.cards || [])];
        const oldTabs = [...(this._config.tabs || [])];
        const oldHoldActions = [...(this._config.tab_hold_actions || [])];
        const oldCardsForHold = [...(this._config.cards || [])];
        const oldIcons = [...(this._config.tab_icons || [])];
        const oldCardsForIcons = [...(this._config.cards || [])];

        // Smartly map old tabs to the new cards array. 
        // This handles deletions, additions, and even drag-and-drop rearrangements automatically.
        const newTabs = updatedCards.map((newCard: any, index: number) => {
          const oldIndex = oldCards.indexOf(newCard);
          if (oldIndex !== -1) {
            const tabName = oldTabs[oldIndex];
            oldCards[oldIndex] = null; // Prevent duplicate matching
            return tabName || `Tab ${index + 1}`;
          }
          
          // If we didn't find the card but array length didn't change, it was likely an edit.
          if (updatedCards.length === (this._config.cards?.length || 0)) {
            return oldTabs[index] || `Tab ${index + 1}`;
          }
          return `Tab ${index + 1}`;
        });

        const newHoldActions = updatedCards.map((newCard: any, index: number) => {
          const oldIndex = oldCardsForHold.indexOf(newCard);
          if (oldIndex !== -1) {
            const action = oldHoldActions[oldIndex];
            oldCardsForHold[oldIndex] = null; 
            return action || { action: 'none' };
          }
          if (updatedCards.length === (this._config.cards?.length || 0)) {
            return oldHoldActions[index] || { action: 'none' };
          }
          return { action: 'none' };
        });

        const newIcons = updatedCards.map((newCard: any, index: number) => {
          const oldIndex = oldCardsForIcons.indexOf(newCard);
          if (oldIndex !== -1) {
            const icon = oldIcons[oldIndex];
            oldCardsForIcons[oldIndex] = null; 
            return icon || '';
          }
          if (updatedCards.length === (this._config.cards?.length || 0)) {
            return oldIcons[index] || '';
          }
          return '';
        });

        this._dispatchEvent({ ...this._config, cards: updatedCards, tabs: newTabs, tab_hold_actions: newHoldActions, tab_icons: newIcons });
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
        
        // Inject a persistent <style> tag. This survives Lit updates and 
        // instantly hides ha-form even if HA delays rendering it.
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

    return html`
      <div class="card-config">
        <ha-formfield label="Show cards outside of tab card" style="display: block; margin-bottom: 16px;">
          <ha-switch
            .checked=${this._config.outside_cards === true}
            @change=${this._handleOutsideCardsChange}
          ></ha-switch>
        </ha-formfield>

        <h3>Tab Configuration</h3>
        
        ${cards.length === 0 
          ? html`<p style="color: var(--secondary-text-color);">Add some cards below to configure their tab names.</p>` 
          : cards.map((_: any, index: number) => html`
              <div style="border: 1px solid var(--divider-color); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                <ha-textfield
                  label="Name for Tab ${index + 1}"
                  .value=${tabs[index] || `Tab ${index + 1}`}
                  .index=${index}
                  @input=${this._handleSingleTabChange}
                  style="width: 100%; margin-bottom: 12px;"
                ></ha-textfield>

                <ha-icon-picker
                  label="Icon for Tab ${index + 1}"
                  .value=${icons[index] || ''}
                  .index=${index}
                  @value-changed=${this._handleSingleIconChange}
                  style="width: 100%; margin-bottom: 12px; display: block;"
                ></ha-icon-picker>

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

        <hr style="border: 0; border-bottom: 1px solid var(--divider-color); margin: 20px 0;">
        
        <div id="editor-container"></div>
      </div>
    `;
  }

  // --- NEW: Handle individual tab name changes ---
  private _handleSingleTabChange(ev: any): void {
    const index = ev.target.index;
    const value = ev.target.value;
    
    // Create a copy of the tabs array (or make a new one if it doesn't exist)
    const tabs = [...(this._config.tabs || [])];
    
    // Update the specific index
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

  private _handleOutsideCardsChange(ev: any): void {
    this._dispatchEvent({ ...this._config, outside_cards: ev.target.checked });
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
  name: 'Tab Card',
  preview: true,
  description: 'A custom card that renders a vertical stack as tabs.'
});