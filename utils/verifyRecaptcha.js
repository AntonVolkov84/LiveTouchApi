import { RecaptchaEnterpriseServiceClient } from '@google-cloud/recaptcha-enterprise';

const client = new RecaptchaEnterpriseServiceClient({
  keyFilename: './recaptcha-service-account.json', 
});

export const verifyCaptcha = async (token, projectId, platform) => {
  const siteKey = platform === 'browser' 
    ? process.env.RECAPTCHA_SITE_KEY_WEB    
    : process.env.RECAPTCHA_SITE_KEY_ANDROID;
      const request = {
    parent: `projects/${projectId}`,
    assessment: {
      event: {
        token,
        siteKey: siteKey, 
        expectedAction: 'register', 
      },
    },
  };

  try {
    const [response] = await client.createAssessment(request);
    const isValid = response.tokenProperties?.valid;
    return { success: isValid, response };
  } catch (err) {
    console.error('Enterprise reCAPTCHA error:', err);
    return { success: false, error: err };
  }
};
