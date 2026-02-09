import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface InvitationEmailProps {
  to: string;
  inviteLink: string;
  organizationName: string;
  inviterName?: string;
}

@Injectable()
export class EmailService {
  private resend: Resend; // Temporarily any to avoid compilation if types aren't perfect yet, but ideally Resend
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY is not defined. Email sending will be disabled.',
      );
    }
    this.resend = new Resend(apiKey);
    this.fromEmail =
      this.configService.get<string>('EMAIL_FROM') ||
      'Morpheus Desk <onboarding@resend.com>';
  }

  async sendInvitation(props: InvitationEmailProps): Promise<void> {
    const { to, inviteLink, organizationName, inviterName } = props;

    try {
      const subject = `You've been invited to join ${organizationName} on Morpheus Desk`;

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; padding: 20px; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 40px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
              .button { display: inline-block; background-color: #000; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin-top: 20px; }
              .footer { margin-top: 30px; font-size: 12px; color: #71717a; }
              .logo { margin-bottom: 24px; text-align: center; }
              .logo img { height: 40px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">
                <img src="${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/logo.png" alt="Morpheus Desk" style="height: 48px;" />
              </div>
              <h2>Hello,</h2>
              <p>
                ${inviterName || 'Someone'} has invited you to join <strong>${organizationName}</strong> on Morpheus Desk.
              </p>
              <p>Morpheus Desk is your all-in-one platform for customer support and ticket management.</p>
              
              <a href="${inviteLink}" class="button">Accept Invitation</a>
              
              <p style="margin-top: 24px; font-size: 14px; color: #52525b;">
                Or copy and paste this link into your browser: <br>
                <a href="${inviteLink}" style="color: #2563eb;">${inviteLink}</a>
              </p>
              
              <div class="footer">
                <p>If you were not expecting this invitation, you can ignore this email.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const response = await this.resend.emails.send({
        from: this.fromEmail,
        to: [to],
        subject,
        html,
      });

      if (response.error) {
        this.logger.error(
          `Failed to send invitation email to ${to}: ${response.error.message}`,
          response.error,
        );
        throw new Error(`Email sending failed: ${response.error.message}`);
      }

      this.logger.log(
        `Invitation email sent to ${to}. ID: ${response.data?.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${to}`, error);
    }
  }

  async sendPasswordResetOTP(to: string, otp: string): Promise<void> {
    try {
      const subject = `Password Reset OTP - Morpheus Desk`;
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: 'Inter', sans-serif; background-color: #f4f4f5; padding: 20px; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 40px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
              .otp-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 4px; color: #0891b2; margin: 24px 0; }
              .footer { margin-top: 30px; font-size: 12px; color: #71717a; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>Reset Your Password</h2>
              <p>You requested a password reset for your Morpheus Desk account. Use the following code to continue:</p>
              
              <div class="otp-box">${otp}</div>
              
              <p>This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
              
              <div class="footer">
                <p>&copy; ${new Date().getFullYear()} Morpheus Technologies. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const response = await this.resend.emails.send({
        from: this.fromEmail,
        to: [to],
        subject,
        html,
      });

      if (response.error) {
        this.logger.error(
          `Failed to send password reset OTP to ${to}: ${response.error.message}`,
        );
        throw new Error(`Email sending failed: ${response.error.message}`);
      }

      this.logger.log(
        `Password reset OTP sent to ${to}. ID: ${response.data?.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send password reset OTP to ${to}`, error);
      throw error;
    }
  }
}
