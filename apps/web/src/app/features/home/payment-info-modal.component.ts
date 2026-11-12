import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { inject, Component, computed, input, output, signal } from '@angular/core';

import { PaymentInfoMethod } from '@models/payment-info.models';

@Component({
  imports: [TranslatePipe],
  selector: 'app-payment-info-modal',
  templateUrl: './payment-info-modal.component.html',
  styleUrl: './payment-info-modal.component.scss'
})
export class PaymentInfoModalComponent {
  private readonly translations = inject(TranslationService);
  readonly methods = input.required<PaymentInfoMethod[]>();
  readonly closeModal = output<void>();

  protected readonly copiedMethod = signal<string | null>(null);
  protected readonly visibleMethods = computed(() => this.methods());

  protected payButtonLabel(method: PaymentInfoMethod): string {
    return method.type === 'revolut' ? this.translations.translate("ui.pay_on_revolut") : this.translations.translate("ui.pay_on_keks");
  }

  protected directPayButtonLabel(method: PaymentInfoMethod): string {
    return method.type === 'revolut' ? this.translations.translate("ui.pay_directly_on_revolut") : this.translations.translate("ui.pay_directly_on_keks");
  }

  protected copyValue(method: PaymentInfoMethod): void {
    if (!method.copyable || method.value.length === 0) {
      return;
    }

    void navigator.clipboard.writeText(method.value).then(() => {
      this.copiedMethod.set(method.type);
      setTimeout(() => {
        if (this.copiedMethod() === method.type) {
          this.copiedMethod.set(null);
        }
      }, 1600);
    });
  }
}
