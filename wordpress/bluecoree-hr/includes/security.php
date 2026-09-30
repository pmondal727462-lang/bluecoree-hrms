<?php
defined('ABSPATH') || exit;

function bluecoree_hr_error(string $code, string $message, int $status = 400): WP_Error {
    return new WP_Error($code, $message, ['status' => $status]);
}

function bluecoree_hr_features(string $plan): array {
    $basic = ['attendance', 'reports', 'mobile', 'face', 'jobtracking'];
    return $plan === 'ADVANCED'
        ? array_merge($basic, ['recruitment', 'training', 'performance', 'expenses', 'onboarding', 'contractors', 'api', 'ai', 'assets', 'workplanning', 'payroll'])
        : $basic;
}

function bluecoree_hr_crypto_key(): string {
    $key = defined('BLUECOREE_HR_ENCRYPTION_KEY') ? BLUECOREE_HR_ENCRYPTION_KEY : '';
    if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/i', $key)) {
        throw new RuntimeException('Configure a 32-byte hexadecimal encryption key in wp-config.php.');
    }
    return hex2bin($key);
}

// Matches the existing HRMS AES-256-GCM iv.tag.data format.
function bluecoree_hr_encrypt(array $value): string {
    $iv = random_bytes(12);
    $tag = '';
    $data = openssl_encrypt(json_encode($value, JSON_THROW_ON_ERROR), 'aes-256-gcm', bluecoree_hr_crypto_key(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($data === false) throw new RuntimeException('Could not encrypt face template.');
    return bin2hex($iv) . '.' . bin2hex($tag) . '.' . bin2hex($data);
}

function bluecoree_hr_decrypt(string $value): array {
    $parts = explode('.', $value);
    if (count($parts) !== 3 || !preg_match('/^[a-f0-9]{24}$/i', $parts[0]) || !preg_match('/^[a-f0-9]{32}$/i', $parts[1]) || !preg_match('/^(?:[a-f0-9]{2})+$/i', $parts[2])) {
        throw new RuntimeException('Invalid encrypted template.');
    }
    $data = openssl_decrypt(hex2bin($parts[2]), 'aes-256-gcm', bluecoree_hr_crypto_key(), OPENSSL_RAW_DATA, hex2bin($parts[0]), hex2bin($parts[1]));
    if ($data === false) throw new RuntimeException('Could not decrypt face template.');
    return json_decode($data, true, 512, JSON_THROW_ON_ERROR);
}

function bluecoree_hr_provider_ready(): bool {
    return defined('BLUECOREE_HR_FACE_URL') && defined('BLUECOREE_HR_FACE_KEY')
        && is_string(BLUECOREE_HR_FACE_KEY) && BLUECOREE_HR_FACE_KEY !== ''
        && str_starts_with((string) BLUECOREE_HR_FACE_URL, 'https://')
        && defined('BLUECOREE_HR_ENCRYPTION_KEY')
        && preg_match('/^[a-f0-9]{64}$/i', (string) BLUECOREE_HR_ENCRYPTION_KEY)
        && function_exists('openssl_encrypt');
}

function bluecoree_hr_validate_provider(array $value, string $request_id, bool $enroll): bool {
    return ($value['requestId'] ?? null) === $request_id
        && ($value['status'] ?? null) === 'SUCCESS'
        && ($value['livenessPassed'] ?? null) === true
        && isset($value['confidence']) && is_numeric($value['confidence'])
        && is_finite((float) $value['confidence']) && (float) $value['confidence'] >= 0.90
        && (float) $value['confidence'] <= 1
        && (!isset($value['faceCount']) || $value['faceCount'] === 1)
        && (!$enroll || (isset($value['template']) && is_string($value['template']) && strlen($value['template']) > 0 && strlen($value['template']) <= 100000));
}

function bluecoree_hr_provider(string $action, string $sample, ?string $template = null): array|WP_Error {
    if (!bluecoree_hr_provider_ready()) return bluecoree_hr_error('FACE_PROVIDER_UNAVAILABLE', 'Face verification service is not configured.', 503);
    if (strlen($sample) > 350000 || !preg_match('/^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/D', $sample)) {
        return bluecoree_hr_error('INVALID_SAMPLE', 'A camera JPEG sample is required.', 422);
    }
    $request_id = wp_generate_uuid4();
    $body = ['requestId' => $request_id, 'sample' => $sample, 'livenessRequired' => true];
    if ($template !== null) $body['template'] = $template;
    $response = wp_safe_remote_post(rtrim(BLUECOREE_HR_FACE_URL, '/') . '/' . $action, [
        'timeout' => 15, 'redirection' => 0, 'limit_response_size' => 150000,
        'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . BLUECOREE_HR_FACE_KEY],
        'body' => wp_json_encode($body),
    ]);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return bluecoree_hr_error('FACE_PROVIDER_UNAVAILABLE', 'Face verification service is unavailable.', 503);
    }
    $result = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($result) || !bluecoree_hr_validate_provider($result, $request_id, $action === 'enroll')) {
        return bluecoree_hr_error('FACE_VERIFICATION_FAILED', 'Face match or liveness verification failed. Try again in good lighting.', 403);
    }
    return $result;
}

function bluecoree_hr_work_date(string $timezone, int $timestamp): string {
    return (new DateTimeImmutable('@' . $timestamp))->setTimezone(new DateTimeZone($timezone))->format('Y-m-d');
}
