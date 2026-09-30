<?php
defined('ABSPATH') || exit;

function bluecoree_hr_employee(): array|WP_Error {
    global $wpdb;
    if (!is_user_logged_in()) return bluecoree_hr_error('UNAUTHENTICATED', 'Please sign in.', 401);
    $employees = bluecoree_hr_table('employees');
    $companies = bluecoree_hr_table('companies');
    $row = $wpdb->get_row($wpdb->prepare("SELECT e.*, c.name AS company_name, c.code AS company_code, c.plan, c.status AS company_status, c.timezone FROM $employees e INNER JOIN $companies c ON c.id=e.company_id WHERE e.user_id=%d AND e.active=1", get_current_user_id()), ARRAY_A);
    if (!$row) return bluecoree_hr_error('NO_EMPLOYEE', 'Your account is not linked to an active employee. Contact HR.', 403);
    if ($row['company_status'] !== 'ACTIVE') return bluecoree_hr_error('SUBSCRIPTION_INACTIVE', 'Your company subscription is not active. Contact HR.', 403);
    return $row;
}

function bluecoree_hr_permission(): bool|WP_Error {
    $employee = bluecoree_hr_employee();
    return is_wp_error($employee) ? $employee : true;
}

function bluecoree_hr_routes(): void {
    foreach (['profile', 'attendance', 'face/status'] as $path) {
        register_rest_route('bluecoree/v1', '/' . $path, [
            'methods' => 'GET', 'permission_callback' => 'bluecoree_hr_permission',
            'callback' => fn(WP_REST_Request $request) => bluecoree_hr_read($path),
        ]);
    }
    foreach (['face/enroll', 'attendance/face-punch'] as $path) {
        register_rest_route('bluecoree/v1', '/' . $path, [
            'methods' => 'POST', 'permission_callback' => 'bluecoree_hr_permission',
            'callback' => fn(WP_REST_Request $request) => bluecoree_hr_scan($path, $request),
        ]);
    }
}

function bluecoree_hr_read(string $path): WP_REST_Response|WP_Error {
    global $wpdb;
    $employee = bluecoree_hr_employee();
    if (is_wp_error($employee)) return $employee;
    if ($path === 'profile') {
        $user = wp_get_current_user();
        $data = ['name' => $user->display_name, 'email' => $user->user_email,
            'employeeCode' => $employee['employee_code'], 'department' => $employee['department'],
            'designation' => $employee['designation'], 'company' => $employee['company_name'],
            'plan' => $employee['plan'], 'features' => bluecoree_hr_features($employee['plan'])];
    } elseif ($path === 'face/status') {
        $data = ['providerConfigured' => bluecoree_hr_provider_ready(), 'enrolled' => !empty($employee['face_template'])];
    } else {
        $table = bluecoree_hr_table('attendance');
        $items = $wpdb->get_results($wpdb->prepare("SELECT id, work_date, check_in, check_out FROM $table WHERE company_id=%d AND employee_id=%d ORDER BY work_date DESC LIMIT 62", $employee['company_id'], $employee['id']), ARRAY_A);
        if ($wpdb->last_error) return bluecoree_hr_error('DATABASE_ERROR', 'Could not load attendance.', 503);
        $today = bluecoree_hr_work_date($employee['timezone'], time());
        $current = null;
        foreach ($items as $item) if ($item['work_date'] === $today) $current = $item;
        $data = ['items' => $items, 'current' => $current, 'timezone' => $employee['timezone']];
    }
    return new WP_REST_Response(['success' => true, 'data' => $data]);
}

function bluecoree_hr_scan(string $path, WP_REST_Request $request): WP_REST_Response|WP_Error {
    global $wpdb;
    $employee = bluecoree_hr_employee();
    if (is_wp_error($employee)) return $employee;
    if (!in_array('face', bluecoree_hr_features($employee['plan']), true)) return bluecoree_hr_error('FEATURE_DISABLED', 'Your plan does not include face attendance.', 403);
    $body = $request->get_json_params();
    if (!is_array($body) || !isset($body['faceSample']) || !is_string($body['faceSample']) || strlen($body['faceSample']) > 350000) return bluecoree_hr_error('INVALID_SAMPLE', 'A camera sample is required.', 422);
    if (!preg_match('/^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/D', $body['faceSample'])) return bluecoree_hr_error('INVALID_SAMPLE', 'A camera JPEG sample is required.', 422);
    $enroll = $path === 'face/enroll';
    if ($enroll && ($body['consent'] ?? null) !== true) return bluecoree_hr_error('CONSENT_REQUIRED', 'Consent is required to register your face.', 422);
    if (!bluecoree_hr_provider_ready()) return bluecoree_hr_error('FACE_PROVIDER_UNAVAILABLE', 'Face verification service is not configured.', 503);
    // Serialize scans across tabs and devices without a background worker.
    $lock = 'bchr:' . substr(hash('sha256', bluecoree_hr_table('employees') . ':' . $employee['id']), 0, 48);
    if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)', $lock)) !== 1) return bluecoree_hr_error('SCAN_BUSY', 'Another face scan is in progress. Please wait.', 409);
    try {
        $employee = bluecoree_hr_employee();
        if (is_wp_error($employee)) return $employee;
        $now = gmdate('Y-m-d H:i:s');
        if ($employee['locked_until'] && $employee['locked_until'] > $now) return bluecoree_hr_error('FACE_LOCKED', 'Face scans are temporarily locked. Try again after 15 minutes.', 429);
        if ($enroll && !empty($employee['face_template'])) return bluecoree_hr_error('ALREADY_ENROLLED', 'Your face is already registered. Ask HR for a reset.', 409);
        if (!$enroll && empty($employee['face_template'])) return bluecoree_hr_error('ENROLLMENT_REQUIRED', 'Register your face first.', 409);
        $samples = bluecoree_hr_table('samples');
        $count = $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $samples WHERE employee_id=%d AND created_at >= %s", $employee['id'], gmdate('Y-m-d H:i:s', time() - 3600)));
        if ($wpdb->last_error) throw new RuntimeException('Could not read scan attempts.');
        if ((int) $count >= 30) return bluecoree_hr_error('RATE_LIMITED', 'Too many scans. Please try again later.', 429);
        $sample_hash = hash('sha256', $body['faceSample']);
        $exists = $wpdb->get_var($wpdb->prepare("SELECT id FROM $samples WHERE employee_id=%d AND sample_hash=%s", $employee['id'], $sample_hash));
        if ($wpdb->last_error) throw new RuntimeException('Could not read scan history.');
        if ($exists) return bluecoree_hr_error('REPLAY_REJECTED', 'Take a new camera capture for each scan.', 409);
        if (false === $wpdb->insert($samples, ['employee_id' => $employee['id'], 'sample_hash' => $sample_hash, 'created_at' => $now])) throw new RuntimeException('Could not save scan attempt.');
        $template = $enroll ? null : bluecoree_hr_decrypt($employee['face_template'])['template'];
        $result = bluecoree_hr_provider($enroll ? 'enroll' : 'verify', $body['faceSample'], $template);
        $employees = bluecoree_hr_table('employees');
        if (is_wp_error($result)) {
            if ($result->get_error_code() === 'FACE_VERIFICATION_FAILED') {
                $failures = ($employee['locked_until'] && $employee['locked_until'] <= $now) ? 1 : (int) $employee['failures'] + 1;
                if (false === $wpdb->update($employees, ['failures' => $failures, 'locked_until' => $failures >= 5 ? gmdate('Y-m-d H:i:s', time() + 900) : null], ['id' => $employee['id'], 'company_id' => $employee['company_id']])) throw new RuntimeException('Could not save failure count.');
                if (!bluecoree_hr_audit((int) $employee['company_id'], 'FACE_FAILED', (int) $employee['id'])) throw new RuntimeException('Could not audit scan.');
            }
            return $result;
        }
        if (false === $wpdb->query('START TRANSACTION')) throw new RuntimeException('Could not start attendance transaction.');
        try {
            if (false === $wpdb->update($employees, ['failures' => 0, 'locked_until' => null], ['id' => $employee['id'], 'company_id' => $employee['company_id']])) throw new RuntimeException('Could not reset failure count.');
            if ($enroll) {
                if (false === $wpdb->update($employees, ['face_template' => bluecoree_hr_encrypt(['template' => $result['template']]), 'consent_at' => $now], ['id' => $employee['id'], 'company_id' => $employee['company_id']])) throw new RuntimeException('Could not save enrollment.');
                if (!bluecoree_hr_audit((int) $employee['company_id'], 'FACE_ENROLLED', (int) $employee['id'])) throw new RuntimeException('Could not audit enrollment.');
                $data = ['enrolled' => true];
            } else {
                $data = bluecoree_hr_record_attendance($employee, $now);
                if (is_wp_error($data)) { $wpdb->query('ROLLBACK'); return $data; }
            }
            if (false === $wpdb->query('COMMIT')) throw new RuntimeException('Could not commit attendance.');
        } catch (Throwable $error) { $wpdb->query('ROLLBACK'); throw $error; }
        return new WP_REST_Response(['success' => true, 'data' => $data]);
    } catch (Throwable $error) {
        return bluecoree_hr_error('SCAN_UNAVAILABLE', 'Could not save face attendance. Ask your administrator to check configuration and database access.', 503);
    } finally {
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
    }
}

function bluecoree_hr_record_attendance(array $employee, string $now): array|WP_Error {
    global $wpdb;
    $table = bluecoree_hr_table('attendance');
    $date = bluecoree_hr_work_date($employee['timezone'], strtotime($now . ' UTC'));
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE employee_id=%d AND company_id=%d AND work_date=%s FOR UPDATE", $employee['id'], $employee['company_id'], $date), ARRAY_A);
    if ($wpdb->last_error) throw new RuntimeException('Could not read current attendance.');
    // UTC times are stored; the company timezone determines the work date.
    if ($row && strtotime($now . ' UTC') - strtotime($row['last_punch'] . ' UTC') < 60) return bluecoree_hr_error('DUPLICATE_PUNCH', 'Wait at least one minute between attendance scans.', 409);
    if ($row) {
        if (false === $wpdb->update($table, ['check_out' => $now, 'last_punch' => $now], ['id' => $row['id'], 'company_id' => $employee['company_id']])) throw new RuntimeException('Could not update attendance.');
        $id = (int) $row['id'];
        $action = 'CHECK_OUT';
    } else {
        if (false === $wpdb->insert($table, ['company_id' => $employee['company_id'], 'employee_id' => $employee['id'], 'work_date' => $date, 'check_in' => $now, 'last_punch' => $now])) throw new RuntimeException('Could not create attendance.');
        $id = (int) $wpdb->insert_id;
        $action = 'CHECK_IN';
    }
    if (!bluecoree_hr_audit((int) $employee['company_id'], $action, $id)) throw new RuntimeException('Could not audit attendance.');
    return ['action' => $action, 'workDate' => $date, 'checkIn' => $row['check_in'] ?? $now, 'checkOut' => $row ? $now : null];
}
