class Tour {
  constructor(steps) {
    this.steps = steps;
    this.currentIndex = 0;
    this.isActive = false;
    this.overlay = null;
    this.popover = null;
    this.activeTarget = null;
    
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.currentIndex = 0;
    this.createDOM();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    this.showStep();
  }

  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    this.clearHighlight();
    if (this.overlay) this.overlay.remove();
    if (this.popover) this.popover.remove();
    this.overlay = null;
    this.popover = null;
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  next() {
    if (this.currentIndex < this.steps.length - 1) {
      this.currentIndex++;
      this.showStep();
    } else {
      this.stop();
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.showStep();
    }
  }

  createDOM() {
    // Overlay
    this.overlay = document.createElement("div");
    this.overlay.className = "tour-overlay";
    document.body.appendChild(this.overlay);

    // Popover
    this.popover = document.createElement("div");
    this.popover.className = "tour-popover glass-panel";
    
    this.popover.innerHTML = `
      <div class="tour-header">
        <span class="tour-title"></span>
        <span class="tour-step-counter"></span>
      </div>
      <div class="tour-body"></div>
      <div class="tour-footer">
        <button class="tour-btn-skip secondary">Skip</button>
        <div class="tour-nav">
          <button class="tour-btn-prev secondary">Back</button>
          <button class="tour-btn-next primary">Next</button>
        </div>
      </div>
    `;
    
    this.popover.querySelector(".tour-btn-skip").addEventListener("click", () => this.stop());
    this.popover.querySelector(".tour-btn-prev").addEventListener("click", () => this.prev());
    this.popover.querySelector(".tour-btn-next").addEventListener("click", () => this.next());
    
    document.body.appendChild(this.popover);
  }

  clearHighlight() {
    if (this.activeTarget) {
      this.activeTarget.classList.remove("tour-highlight");
      this.activeTarget.style.pointerEvents = "";
      this.activeTarget = null;
    }
  }

  showStep() {
    this.clearHighlight();
    
    const step = this.steps[this.currentIndex];
    const target = document.querySelector(step.target);
    
    if (!target) {
      console.warn("Tour target not found:", step.target);
      return this.next(); // skip invalid steps
    }
    
    this.activeTarget = target;
    target.classList.add("tour-highlight");
    
    // Disable interactions on highlighted element if we want, but letting them click is fine.
    // We will just let it be pointer-events: auto so it's above overlay.

    // Update Popover content
    this.popover.querySelector(".tour-title").textContent = step.title;
    this.popover.querySelector(".tour-step-counter").textContent = `${this.currentIndex + 1} of ${this.steps.length}`;
    this.popover.querySelector(".tour-body").textContent = step.text;
    
    const nextBtn = this.popover.querySelector(".tour-btn-next");
    nextBtn.textContent = this.currentIndex === this.steps.length - 1 ? "Finish" : "Next";
    
    const prevBtn = this.popover.querySelector(".tour-btn-prev");
    prevBtn.style.display = this.currentIndex === 0 ? "none" : "block";

    this.positionPopover(target);
    
    // Smooth scroll to target if not fully in view
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  positionPopover(target) {
    const rect = target.getBoundingClientRect();
    const popoverRect = this.popover.getBoundingClientRect();
    const margin = 20;
    
    // Calculate space available around the target
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceRight = window.innerWidth - rect.right;
    
    let top, left;

    // Default to placing it on the right
    if (spaceRight > popoverRect.width + margin) {
      top = rect.top + window.scrollY + (rect.height / 2) - (popoverRect.height / 2);
      left = rect.right + margin;
    } 
    // Fallback to placing it below
    else if (spaceBelow > popoverRect.height + margin) {
      top = rect.bottom + window.scrollY + margin;
      left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
    } 
    // Fallback to placing it left
    else if (rect.left > popoverRect.width + margin) {
      top = rect.top + window.scrollY + (rect.height / 2) - (popoverRect.height / 2);
      left = rect.left - popoverRect.width - margin;
    }
    // Fallback to placing it above
    else {
      top = rect.top + window.scrollY - popoverRect.height - margin;
      left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
    }

    // Keep popover within viewport bounds horizontally
    left = Math.max(margin, Math.min(left, window.innerWidth - popoverRect.width - margin));
    
    this.popover.style.top = `${top}px`;
    this.popover.style.left = `${left}px`;
  }

  handleResize() {
    if (this.isActive && this.activeTarget) {
      this.positionPopover(this.activeTarget);
    }
  }
  
  handleKeyDown(e) {
    if (!this.isActive) return;
    if (e.key === "Escape") this.stop();
    if (e.key === "ArrowRight") this.next();
    if (e.key === "ArrowLeft") this.prev();
  }
}

// Export a singleton instance globally
window.TourManager = new Tour([
  {
    target: ".trade-ticket",
    title: "1. The Candidate Setup",
    text: "Define your trade parameters here or use the Demo Values button to randomize them. The AI agent will evaluate these inputs."
  },
  {
    target: ".ticker-panel",
    title: "2. Live Market Data",
    text: "Automatically pulls real-time mark prices from Bitget directly into your ticket, keeping your execution precise."
  },
  {
    target: ".action-panel",
    title: "3. The Refusal Engine",
    text: "Submit your setup to the AI. It acts as an aggressive gatekeeper, analyzing the risk profile of the candidate trade."
  },
  {
    target: ".decision-card",
    title: "4. AI Decision",
    text: "The agent returns a strict TRADE or NO TRADE verdict, breaking down exactly why it blocked or approved your setup."
  },
  {
    target: ".risk-breakdown",
    title: "5. Setup Quality",
    text: "A visual breakdown of how your setup scored against the engine's strict guardrails for liquidity, spread, and risk."
  },
  {
    target: ".safety-panel-console",
    title: "6. Execution Guard",
    text: "If approved, the agent will submit the live order to your Bitget account here, enforcing strict notional sizing caps."
  }
]);
