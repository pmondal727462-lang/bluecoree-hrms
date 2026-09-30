<?php
// Local isolated WordPress database only. Never execute against a live installation.
if (getenv('WORDPRESS_DB_NAME') !== 'bluecoree_test' || getenv('WORDPRESS_DB_HOST') !== 'database') {
    fwrite(STDERR, "Refusing to run fixtures outside the isolated test database.\n"); exit(1);
}
define('WP_INSTALLING', true);
define('BLUECOREE_HR_ENCRYPTION_KEY', str_repeat('ab', 32));
define('BLUECOREE_HR_FACE_URL', 'https://example.com');
define('BLUECOREE_HR_FACE_KEY', 'local-fixture-only');
$_SERVER['HTTP_HOST'] = '127.0.0.1:8090';
$_SERVER['SERVER_NAME'] = '127.0.0.1';
$_SERVER['REQUEST_URI'] = '/';
$bootstrap_db = new mysqli(getenv('WORDPRESS_DB_HOST'), getenv('WORDPRESS_DB_USER'), getenv('WORDPRESS_DB_PASSWORD'), getenv('WORDPRESS_DB_NAME'));
if ($bootstrap_db->query("SHOW TABLES LIKE 'wp_options'")->num_rows) {
    $bootstrap_db->query("UPDATE wp_options SET option_value='http://127.0.0.1:8090' WHERE option_name IN ('siteurl','home') AND option_value=''");
}
$bootstrap_db->close();
require '/var/www/html/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
if (!is_blog_installed()) wp_install('BlueCoreeHR isolated test', 'local-owner', 'local-owner@example.test', false, '', bin2hex(random_bytes(24)));
require_once ABSPATH . 'wp-content/plugins/bluecoree-hr/bluecoree-hr.php';
bluecoree_hr_install();
update_option('home', 'http://127.0.0.1:8090');
update_option('siteurl', 'http://127.0.0.1:8090');
update_option('active_plugins', ['bluecoree-hr/bluecoree-hr.php']);

$checks = 0;
function check(bool $condition, string $message): void {
    global $checks;
    $checks++;
    if (!$condition) throw new RuntimeException('FAILED: ' . $message);
    echo "PASS $message\n";
}
function call_api(string $method, string $path, ?array $body = null): WP_REST_Response {
    $request = new WP_REST_Request($method, '/bluecoree/v1/' . $path);
    if ($body !== null) { $request->set_header('Content-Type', 'application/json'); $request->set_body(wp_json_encode($body)); }
    return rest_do_request($request);
}
$users = [];
$companies = [];
$employee_ids = [];
$suffix = substr(bin2hex(random_bytes(8)), 0, 12);
$provider_mode = 'success';
add_filter('pre_http_request', function ($pre, $args, $url) use (&$provider_mode) {
    if (!str_starts_with($url, BLUECOREE_HR_FACE_URL . '/')) return $pre;
    $request = json_decode($args['body'], true);
    $result = ['requestId' => $request['requestId'], 'confidence' => 0.99, 'livenessPassed' => true, 'status' => 'SUCCESS', 'faceCount' => 1];
    if (str_ends_with($url, '/enroll')) $result['template'] = 'fixture-template';
    if ($provider_mode === 'spoof') $result['livenessPassed'] = false;
    if ($provider_mode === 'mismatch') $result['requestId'] = 'wrong';
    if ($provider_mode === 'multiple') $result['faceCount'] = 2;
    return ['headers' => [], 'body' => wp_json_encode($result), 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => []];
}, 10, 3);

try {
    global $wpdb;
    foreach (['BASIC', 'ADVANCED'] as $plan) {
        check(false !== $wpdb->insert(bluecoree_hr_table('companies'), ['code' => $plan . $suffix, 'name' => $plan . ' fixture', 'plan' => $plan, 'timezone' => 'Asia/Kolkata', 'created_at' => gmdate('Y-m-d H:i:s')]), 'create ' . $plan . ' fixture company');
        $companies[] = (int) $wpdb->insert_id;
        $id = wp_insert_user(['user_login' => $plan . $suffix, 'user_email' => $plan . $suffix . '@example.test', 'user_pass' => bin2hex(random_bytes(16)), 'role' => 'bluecoree_employee']);
        check(!is_wp_error($id), 'create ' . $plan . ' employee');
        $users[] = $id;
        check(false !== $wpdb->insert(bluecoree_hr_table('employees'), ['company_id' => end($companies), 'user_id' => $id, 'employee_code' => 'E001', 'created_at' => gmdate('Y-m-d H:i:s')]), 'link ' . $plan . ' employee');
        $employee_ids[] = (int) $wpdb->insert_id;
    }
    wp_set_current_user(0);
    check(call_api('GET', 'profile')->get_status() === 401, 'reject unauthenticated employee API');
    wp_set_current_user($users[0]);
    $profile = call_api('GET', 'profile')->get_data()['data'];
    check($profile['plan'] === 'BASIC' && !in_array('payroll', $profile['features'], true), 'Basic excludes Advanced features');
    check(!current_user_can('manage_options'), 'employee cannot access management');
    check(!str_contains(do_shortcode('[bluecoree_hr]'), 'face_template'), 'employee portal never embeds template');
    wp_set_current_user($users[1]);
    check(in_array('payroll', call_api('GET', 'profile')->get_data()['data']['features'], true), 'Advanced retains separate feature entitlement');
    wp_set_current_user($users[0]);
    check(call_api('GET', 'face/status')->get_data()['data']['enrolled'] === false, 'new employee needs enrollment');
    check(call_api('POST', 'face/enroll', ['faceSample' => 'data:image/jpeg;base64,YQ=='])->get_status() === 422, 'enrollment requires consent');
    check(call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,YQ=='])->get_status() === 409, 'attendance requires enrollment');
    check(call_api('POST', 'face/enroll', ['faceSample' => 'data:image/jpeg;base64,YQ==', 'consent' => true])->get_status() === 200, 'verified enrollment succeeds');
    $stored = $wpdb->get_var($wpdb->prepare('SELECT face_template FROM ' . bluecoree_hr_table('employees') . ' WHERE id=%d', $employee_ids[0]));
    check(!str_contains($stored, 'fixture-template') && bluecoree_hr_decrypt($stored)['template'] === 'fixture-template', 'template encrypted at rest');
    check(call_api('POST', 'face/enroll', ['faceSample' => 'data:image/jpeg;base64,Yg==', 'consent' => true])->get_status() === 409, 'cannot replace enrolled identity');
    $first = call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,Yg==']);
    check($first->get_status() === 200 && $first->get_data()['data']['action'] === 'CHECK_IN', 'first scan checks in');
    check(call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,Yg=='])->get_status() === 409, 'reject image replay');
    check(call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,Yw=='])->get_status() === 409, 'reject rapid duplicate attendance');
    $table = bluecoree_hr_table('attendance');
    $original_in = $wpdb->get_var($wpdb->prepare("SELECT check_in FROM $table WHERE employee_id=%d", $employee_ids[0]));
    $wpdb->update($table, ['last_punch' => gmdate('Y-m-d H:i:s', time() - 120)], ['employee_id' => $employee_ids[0]]);
    $out = call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,ZA==']);
    check($out->get_status() === 200 && $out->get_data()['data']['action'] === 'CHECK_OUT', 'later scan checks out');
    $wpdb->update($table, ['last_punch' => gmdate('Y-m-d H:i:s', time() - 120)], ['employee_id' => $employee_ids[0]]);
    $latest = call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,ZQ==']);
    check($latest->get_status() === 200 && $latest->get_data()['data']['checkIn'] === $original_in && $latest->get_data()['data']['checkOut'] !== null, 'third scan preserves first check-in and updates checkout');
    wp_set_current_user($users[1]);
    check(count(call_api('GET', 'attendance')->get_data()['data']['items']) === 0, 'other company cannot read employee attendance');
    wp_set_current_user($users[0]);
    $provider_mode = 'spoof';
    for ($i = 0; $i < 5; $i++) check(call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,' . base64_encode('spoof' . $i)])->get_status() === 403, 'reject spoof attempt ' . ($i + 1));
    $provider_mode = 'success';
    check(call_api('POST', 'attendance/face-punch', ['faceSample' => 'data:image/jpeg;base64,Zg=='])->get_status() === 429, 'lock after repeated failed face scans');
    $wpdb->update(bluecoree_hr_table('companies'), ['status' => 'SUSPENDED'], ['id' => $companies[0]]);
    check(call_api('GET', 'profile')->get_status() === 403, 'suspended company blocked on server');
    check(bluecoree_hr_work_date('Asia/Kolkata', strtotime('2026-01-01 20:00:00 UTC')) === '2026-01-02', 'company timezone determines attendance date');
    $valid = ['requestId' => 'r', 'confidence' => 0.99, 'livenessPassed' => true, 'status' => 'SUCCESS', 'faceCount' => 1, 'template' => 't'];
    check(!bluecoree_hr_validate_provider($valid, 'wrong', true), 'reject provider request mismatch');
    check(!bluecoree_hr_validate_provider(array_merge($valid, ['faceCount' => 2]), 'r', true), 'reject multiple faces');
    check(!bluecoree_hr_validate_provider(array_merge($valid, ['confidence' => 0.2]), 'r', false), 'reject weak face match');
    check(!bluecoree_hr_validate_provider(array_merge($valid, ['livenessPassed' => false]), 'r', false), 'require real liveness result');
    try { bluecoree_hr_decrypt(substr($stored, 0, -2) . (substr($stored, -2) === '00' ? '01' : '00')); check(false, 'reject modified ciphertext'); }
    catch (RuntimeException $error) { check(true, 'reject modified ciphertext'); }
    check(count($wpdb->get_results('SELECT * FROM ' . bluecoree_hr_table('audit') . ' WHERE company_id=' . (int) $companies[0])) >= 9, 'enrollment, attendance and failed scans audited');
    wp_set_current_user(get_user_by('login', 'local-owner')->ID);
    ob_start(); bluecoree_hr_admin_page(); $management = ob_get_clean();
    check(str_contains($management, 'Login email') && str_contains($management, $profile['email']), 'management shows employee login email');
    echo "All $checks checks passed.\n";
} finally {
    // Delete only fixture IDs created by this run in this isolated database.
    foreach ($employee_ids as $id) {
        $wpdb->delete(bluecoree_hr_table('samples'), ['employee_id' => $id]);
        $wpdb->delete(bluecoree_hr_table('attendance'), ['employee_id' => $id]);
        $wpdb->delete(bluecoree_hr_table('employees'), ['id' => $id]);
    }
    foreach ($companies as $id) { $wpdb->delete(bluecoree_hr_table('audit'), ['company_id' => $id]); $wpdb->delete(bluecoree_hr_table('companies'), ['id' => $id]); }
    require_once ABSPATH . 'wp-admin/includes/user.php';
    foreach ($users as $id) wp_delete_user($id);
}
