// Simple lyrics compensation adjuster for real-time tuning
export class CompensationAdjuster {
    private currentCompensation: number = 1000; // Default 1000ms
    private adjustmentElement: HTMLElement | null = null;
    private isVisible = false;

    constructor() {
        this.createAdjusterUI();
        this.setupKeyboardShortcuts();
    }

    private createAdjusterUI() {
        // Create adjustment UI (hidden by default)
        this.adjustmentElement = document.createElement('div');
        this.adjustmentElement.id = 'lyrics-compensation-adjuster';
        this.adjustmentElement.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            z-index: 1000;
            display: none;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        `;

        this.updateAdjusterText();
        document.body.appendChild(this.adjustmentElement);
    }

    private updateAdjusterText() {
        if (this.adjustmentElement) {
            this.adjustmentElement.innerHTML = `
                <div>🎵 Lyrics Compensation</div>
                <div style="margin-top: 5px; font-size: 14px; font-weight: bold;">
                    ${this.currentCompensation}ms
                </div>
                <div style="margin-top: 5px; opacity: 0.7;">
                    ← → arrows to adjust<br>
                    Shift+L to toggle
                </div>
            `;
        }
    }

    private setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            // Toggle adjuster with Shift+L
            if (event.shiftKey && event.key.toLowerCase() === 'l') {
                event.preventDefault();
                this.toggleAdjuster();
                return;
            }

            // Only handle adjustment keys when adjuster is visible
            if (!this.isVisible) return;

            let adjustment = 0;
            let preventDefault = true;

            switch (event.key) {
                case 'ArrowLeft':
                    adjustment = event.shiftKey ? -50 : -10;
                    break;
                case 'ArrowRight':
                    adjustment = event.shiftKey ? 50 : 10;
                    break;
                case 'ArrowUp':
                    adjustment = event.shiftKey ? 100 : 25;
                    break;
                case 'ArrowDown':
                    adjustment = event.shiftKey ? -100 : -25;
                    break;
                case 'r':
                case 'R':
                    // Reset to default
                    this.setCompensation(200);
                    break;
                default:
                    preventDefault = false;
            }

            if (preventDefault) {
                event.preventDefault();
                if (adjustment !== 0) {
                    this.adjustCompensation(adjustment);
                }
            }
        });
    }

    private toggleAdjuster() {
        this.isVisible = !this.isVisible;
        if (this.adjustmentElement) {
            this.adjustmentElement.style.display = this.isVisible ? 'block' : 'none';
        }

        if (this.isVisible) {
            console.log('Lyrics compensation adjuster enabled. Use arrow keys to adjust timing.');
        } else {
            console.log('Lyrics compensation adjuster disabled.');
        }
    }

    private adjustCompensation(deltaMs: number) {
        const newCompensation = Math.max(0, Math.min(2000, this.currentCompensation + deltaMs));
        this.setCompensation(newCompensation);
    }

    private setCompensation(compensationMs: number) {
        this.currentCompensation = compensationMs;
        this.updateAdjusterText();

        // Send to backend via the nowplaying API
        if (window.np && typeof window.np.setLyricsCompensation === 'function') {
            window.np.setLyricsCompensation(compensationMs);
        }

        console.log(`Lyrics compensation set to ${compensationMs}ms`);
    }

    // Public method to get current compensation
    getCompensation(): number {
        return this.currentCompensation;
    }
}

// Auto-initialize if debug mode or if explicitly enabled
let compensationAdjuster: CompensationAdjuster | null = null;

export function initCompensationAdjuster() {
    if (!compensationAdjuster) {
        compensationAdjuster = new CompensationAdjuster();
        console.log('Lyrics compensation adjuster initialized. Press Shift+L to toggle.');
    }
}

export function getCompensationAdjuster(): CompensationAdjuster | null {
    return compensationAdjuster;
}