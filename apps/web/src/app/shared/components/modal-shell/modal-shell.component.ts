import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-modal-shell',
  templateUrl: './modal-shell.component.html',
  styleUrl: './modal-shell.component.scss'
})
export class ModalShellComponent {
  readonly labelledBy = input.required<string>();
  readonly panelWidth = input('520px');
  readonly closeOnBackdrop = input(false);
  readonly drawer = input(false);
  readonly ownedControls = input<string | null>(null);

  readonly closeModal = output<void>();

  protected closeFromBackdrop(): void {
    if (this.closeOnBackdrop()) {
      this.closeModal.emit();
    }
  }
}
